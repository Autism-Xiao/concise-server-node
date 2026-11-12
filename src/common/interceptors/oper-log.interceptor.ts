import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { from, throwError, type Observable } from 'rxjs'
import { catchError, concatMap, mergeMap } from 'rxjs/operators'

import { OPER_LOG_KEY } from '../decorators/oper-log.decorator'
import { LogService } from '../../modules/system/log/log.service'

/** 需要记录操作日志的 HTTP 方法 → operate_type（2 添加 / 3 更新 / 4 删除） */
const METHOD_OPERATE_TYPE: Record<string, number> = { POST: 2, PUT: 3, PATCH: 3, DELETE: 4 }
/** 不记录操作日志的路径（登录/刷新由登录日志单独记录） */
const SKIPPED_PATHS = ['/auth/login', '/auth/refresh']
/** 参数序列化的最大长度，超出截断 */
const MAX_PARAMS_LENGTH = 2000

/** 递归脱敏：密码类字段的值替换为 *** */
function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitize)
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = /password/i.test(key) ? '***' : sanitize(val)
    }
    return result
  }
  return value
}

/**
 * 从异常里取可读消息
 * - ValidationPipe 把多条校验错误放在 response.message 数组里
 * - BizException 的真实文案在 response.message（error.message 只有 "Http Exception"）
 * - 都取不到时退回 error.message，保证日志里不出现 undefined
 */
function resolveErrorMessage(error: unknown): string {
  const response = (error as { getResponse?: () => unknown } | null)?.getResponse?.()
  const raw = response && typeof response === 'object' ? (response as { message?: unknown }).message : undefined
  const message = Array.isArray(raw) ? raw.join('；') : raw
  if (typeof message === 'string' && message) {
    return message
  }
  const fallback = (error as { message?: unknown } | null)?.message
  return typeof fallback === 'string' && fallback ? fallback : '未知错误'
}

/**
 * 全局操作日志拦截器：写操作（POST/PUT/DELETE/PATCH）成功或失败都自动落库 oper_log
 * 仅记录已登录用户的操作；日志在响应返回前 await 写完，写失败不影响业务（LogService 内部已兜底）
 */
@Injectable()
export class OperLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly logService: LogService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>()
    const method = request.method.toUpperCase()

    const operateType = METHOD_OPERATE_TYPE[method]
    if (!operateType) {
      return next.handle()
    }
    if (SKIPPED_PATHS.some(path => request.path.includes(path))) {
      return next.handle()
    }

    const user = (request as Request & { user?: { id?: string; username?: string } }).user
    if (!user?.id) {
      return next.handle()
    }

    const startedAt = Date.now()
    const module =
      this.reflector.getAllAndOverride<string>(OPER_LOG_KEY, [context.getHandler(), context.getClass()]) ?? context.getClass().name.replace(/Controller$/, '')
    const action = `${method} ${request.path}`
    const params = JSON.stringify({ query: sanitize(request.query), body: sanitize(request.body) }).slice(0, MAX_PARAMS_LENGTH)

    return next.handle().pipe(
      // 等日志落库后再把结果交给调用方：fire-and-forget 会让 INSERT 超出请求 trace 的生命周期，
      // @nestjs/observe 会报 unfinished span，进程退出时也可能丢掉最后几条日志。
      // recordOper 内部已 try/catch，日志失败不会污染业务响应。
      concatMap(async (data: unknown) => {
        await this.logService.recordOper({
          userId: user.id,
          username: user.username,
          module,
          action,
          operateType,
          ip: request.ip ?? '',
          params,
          status: 0, // 取值语义：0 正常（成功）
          elapsed: Date.now() - startedAt
        })
        return data
      }),
      catchError((error: unknown) => {
        // 先补一条失败日志，再把原始异常交回全局异常过滤器，错误响应保持原样
        return from(
          this.logService.recordOper({
            userId: user.id,
            username: user.username,
            module,
            action,
            operateType,
            ip: request.ip ?? '',
            params,
            status: 1, // 取值语义：1 异常（失败）
            errorMsg: resolveErrorMessage(error).slice(0, 255),
            elapsed: Date.now() - startedAt
          })
        ).pipe(mergeMap(() => throwError(() => error)))
      })
    )
  }
}
