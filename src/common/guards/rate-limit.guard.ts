import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { BizErrorCode } from '../enums/biz-error-code.enum'
import { BizException } from '../exceptions/biz.exception'
import { RATE_LIMIT_KEY, type RateLimitOptions } from '../decorators/rate-limit.decorator'
import { envBoolean, envNumber } from '../../global/env'
import { RateLimitService } from '../../shared/rate-limit/rate-limit.service'

/** 全局默认阈值：单 IP 单接口 120 次/分钟（正常后台操作远低于此，突发刷新也不会误伤） */
const DEFAULT_LIMIT = 120
const DEFAULT_WINDOW = 60

/** 限流计数 key 前缀（与 Redis 在线会话/黑名单区分开，方便运维按前缀清理） */
const KEY_PREFIX = 'rl:'

interface RequestLike {
  ip?: string
  method?: string
  route?: { path?: string }
  originalUrl?: string
  url?: string
  body?: Record<string, unknown>
}

/**
 * 全局限流守卫（APP_GUARD，注册在 JwtAuthGuard 之前）
 *
 * 为什么放在认证之前：未登录的暴力请求同样消耗连接与 CPU，先限流再鉴权更省资源。
 * 为什么自己写而不引 @nestjs/throttler：登录失败锁定需要「按账号累计失败次数」，
 * 与本守卫共用同一计数器（Redis / 内存双后端）比再引一层依赖更直接，也能精确控制文案与状态码。
 *
 * 降级策略：Redis 不可用时 RateLimitService 自动退回进程内计数，限流永远不成为故障点。
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!envBoolean('RATE_LIMIT_ENABLED', true)) {
      return true
    }

    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()])
    const limit = options?.limit ?? envNumber('RATE_LIMIT_LIMIT', DEFAULT_LIMIT)
    const windowSeconds = options?.window ?? envNumber('RATE_LIMIT_WINDOW', DEFAULT_WINDOW)
    if (limit <= 0) {
      return true
    }

    const request = context.switchToHttp().getRequest<RequestLike>()
    const ip = (request.ip ?? 'unknown').replace(/^::ffff:/, '')
    // 路由模板（/v1/users/:id）而非原始 URL，避免 id 不同就被算成不同桶
    const route = `${request.method ?? 'GET'} ${request.route?.path ?? request.originalUrl ?? request.url ?? ''}`
    const rawAccount = request.body?.username
    const account = options?.by === 'account' && typeof rawAccount === 'string' ? rawAccount.trim().toLowerCase() : ''
    const key = `${KEY_PREFIX}${route}:${ip}${account ? `:${account}` : ''}`

    const hit = await this.rateLimitService.increment(key, windowSeconds)
    if (hit.count > limit) {
      const retryAfter = Math.max(Math.ceil((hit.resetAt - Date.now()) / 1000), 1)
      throw new BizException(BizErrorCode.RATE_LIMITED, options?.message ?? `请求过于频繁，请 ${retryAfter} 秒后再试`, HttpStatus.TOO_MANY_REQUESTS)
    }
    return true
  }
}
