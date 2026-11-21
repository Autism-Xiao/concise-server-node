import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { from, throwError, type Observable } from 'rxjs'
import { catchError, concatMap, mergeMap } from 'rxjs/operators'

import { OPER_LOG_KEY } from '../decorators/oper-log.decorator'
import { LogService } from '../../modules/system/log/log.service'
import { SystemConfigService } from '../../modules/system/config/system-config.service'
import { TenantContext } from '../../shared/tenant/tenant.context'

/** 需要记录操作日志的 HTTP 方法 → operate_type（2 添加 / 3 更新 / 4 删除） */
const METHOD_OPERATE_TYPE: Record<string, number> = { POST: 2, PUT: 3, PATCH: 3, DELETE: 4 }
/**
 * 不记录操作日志的路径：登录/刷新由登录日志单独记录；
 * 切换租户由 TenantService.switch 写语义化日志（「切换租户 → #19」「→ 平台视角」），
 * 走拦截器只会多一条看不懂的「TenantV1 - POST /api/v1/tenants/switch」。
 */
const SKIPPED_PATHS = ['/auth/login', '/auth/refresh', '/tenants/switch']
/** 参数序列化的最大长度，超出截断 */
const MAX_PARAMS_LENGTH = 2000
/** 特性开关：操作日志敏感参数脱敏（sys_config `feature.log.maskSensitive`，租户可覆盖） */
const MASK_SENSITIVE_FLAG = 'log.maskSensitive'
/** 敏感键名：命中即整值打码（客户手机号、订单金额/成本价等） */
const SENSITIVE_KEY_RE = /phone|mobile|amount|cost|price|salary/i
/** 整串手机号形态（用于判定是否保留前3后4）与字符串内嵌手机号替换（/g 有 lastIndex 状态，判定不用它） */
const MOBILE_EXACT_RE = /^1[3-9]\d{9}$/
const MOBILE_VALUE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/g

/** 手机号打码：保留前 3 后 4；非手机号值整值替换为 *** */
function maskValue(value: string): string {
  return MOBILE_EXACT_RE.test(value) ? `${value.slice(0, 3)}****${value.slice(-4)}` : '***'
}

/**
 * 递归脱敏：密码类字段的值替换为 ***（永远生效）；
 * maskSensitive=true（feature.log.maskSensitive 开启）时额外打码敏感键值与手机号形态字符串，
 * 堵住字段级脱敏后 sys_log.params 仍留明文手机号/金额的旁路。
 * 导出供单测锁定脱敏口径。
 */
export function sanitize(value: unknown, maskSensitive = false): unknown {
  if (Array.isArray(value)) {
    return value.map(item => sanitize(item, maskSensitive))
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (/password/i.test(key)) {
        result[key] = '***'
      } else if (maskSensitive && SENSITIVE_KEY_RE.test(key) && val !== null && val !== undefined && val !== '') {
        result[key] = typeof val === 'string' ? maskValue(val) : '***'
      } else {
        result[key] = sanitize(val, maskSensitive)
      }
    }
    return result
  }
  if (maskSensitive && typeof value === 'string') {
    return value.replace(MOBILE_VALUE_RE, matched => `${matched.slice(0, 3)}****${matched.slice(-4)}`)
  }
  return value
}

/**
 * 平台视角审计路径：平台管理员在「平台视角」（tenant_id=0）下读取这些业务数据时强制留痕。
 * 规范要求：平台超管看不到租户业务数据，除非代维并留审计——平台视角看全量数据本身就是
 * 敏感动作，读取也必须可追溯。写入型请求本来就全量落日志（tenant_id=0 已天然隔离），
 * 这里只补 GET 的空档。
 */
const PLATFORM_VIEW_AUDIT_PATHS = ['/v1/biz_order', '/v1/customer', '/v1/supplier', '/v1/tasks', '/v1/notices', '/v1/messages', '/v1/files']

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
    private readonly logService: LogService,
    private readonly systemConfig: SystemConfigService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>()
    const method = request.method.toUpperCase()

    const operateType = METHOD_OPERATE_TYPE[method]
    if (SKIPPED_PATHS.some(path => request.path.includes(path))) {
      return next.handle()
    }

    const user = (request as Request & { user?: { id?: string; username?: string } }).user
    if (!user?.id) {
      return next.handle()
    }

    // 平台视角读业务数据：平台管理员未切租户（tenant_id=0）时访问业务模块的 GET 强制审计
    if (!operateType && method === 'GET' && TenantContext.isSuper() && TenantContext.currentTenantId() === null) {
      const audited = PLATFORM_VIEW_AUDIT_PATHS.find(path => request.path.includes(path))
      if (audited) {
        const startedAt = Date.now()
        const action = `${method} ${request.path}`
        return next.handle().pipe(
          concatMap(async (data: unknown) => {
            // 落库前才读开关（sys_config 进程内缓存，开销可忽略），脱敏只影响日志内容不影响响应
            const mask = await this.systemConfig.getBoolean(MASK_SENSITIVE_FLAG, false)
            const params = JSON.stringify({ query: sanitize(request.query, mask) }).slice(0, MAX_PARAMS_LENGTH)
            await this.logService.recordOper({
              userId: user.id,
              username: user.username,
              module: '平台视角审计',
              action: `平台视角查看业务数据 - ${action}`,
              operateType: 1,
              ip: request.ip ?? '',
              params,
              tenantId: 0,
              isProxy: 1,
              status: 0,
              elapsed: Date.now() - startedAt
            })
            return data
          })
        )
      }
    }

    if (!operateType) {
      return next.handle()
    }

    const startedAt = Date.now()
    const module =
      this.reflector.getAllAndOverride<string>(OPER_LOG_KEY, [context.getHandler(), context.getClass()]) ?? context.getClass().name.replace(/Controller$/, '')
    const action = `${method} ${request.path}`
    // params 惰性构建：开关读取在 concatMap/catchError 里进行（失败日志也要同口径脱敏）
    let params: string | null = null
    const buildParams = async (): Promise<string> => {
      const mask = await this.systemConfig.getBoolean(MASK_SENSITIVE_FLAG, false)
      return JSON.stringify({ query: sanitize(request.query, mask), body: sanitize(request.body, mask) }).slice(0, MAX_PARAMS_LENGTH)
    }

    return next.handle().pipe(
      // 等日志落库后再把结果交给调用方：fire-and-forget 会让 INSERT 超出请求 trace 的生命周期，
      // @nestjs/observe 会报 unfinished span，进程退出时也可能丢掉最后几条日志。
      // recordOper 内部已 try/catch，日志失败不会污染业务响应。
      concatMap(async (data: unknown) => {
        params ??= await buildParams()
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
          (async () => {
            params ??= await buildParams()
            return this.logService.recordOper({
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
          })()
        ).pipe(mergeMap(() => throwError(() => error)))
      })
    )
  }
}
