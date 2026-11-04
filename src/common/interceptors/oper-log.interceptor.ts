import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import type { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'

import { OPER_LOG_KEY } from '../decorators/oper-log.decorator'
import { LogService } from '../../modules/system/log/log.service'

/** 需要记录操作日志的 HTTP 方法 → jeecg operate_type（2 添加 / 3 更新 / 4 删除） */
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
 * 全局操作日志拦截器：写操作（POST/PUT/DELETE/PATCH）成功或失败都自动落库 oper_log
 * 仅记录已登录用户的操作；日志写入失败不影响业务（LogService 内部已兜底）
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
      tap({
        next: () => {
          void this.logService.recordOper({
            userId: user.id,
            username: user.username,
            module,
            action,
            operateType,
            ip: request.ip ?? '',
            params,
            status: 0, // jeecg 语义：0 正常（成功）
            elapsed: Date.now() - startedAt
          })
        },
        error: (error: { message?: string }) => {
          void this.logService.recordOper({
            userId: user.id,
            username: user.username,
            module,
            action,
            operateType,
            ip: request.ip ?? '',
            params,
            status: 1, // jeecg 语义：1 异常（失败）
            errorMsg: error?.message?.slice(0, 255),
            elapsed: Date.now() - startedAt
          })
        }
      })
    )
  }
}
