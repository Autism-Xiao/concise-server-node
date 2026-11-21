import type { RateLimitOptions } from '../decorators/rate-limit.decorator'

/** 限流计数 key 前缀（与 Redis 在线会话/黑名单区分开，方便运维按前缀清理） */
export const RATE_LIMIT_KEY_PREFIX = 'rl:'

export interface RateLimitKeyInput {
  /** 路由模板，例如 `POST /v1/files` */
  route: string
  /** 来源 IP（已去掉 ::ffff: 前缀） */
  ip: string
  /** 账号维度值（守卫在 JWT 前，通常只有登录接口的 body.username 可用） */
  account?: string
  /** 当前租户：null=平台视角、0=匿名/无归属、>0=具体租户 */
  tenantId?: number | null
  by?: RateLimitOptions['by']
}

/**
 * 构造限流计数 key（纯函数，便于单测）
 *
 * - tenant 维度且 tenantId>0：`rl:{route}:t{tenantId}` —— 刻意不带 IP，
 *   同一租户的所有成员/出口 IP 共用一个桶，这才是「租户级 API 配额」的语义。
 * - 匿名/平台视角（tenantId=null 或 0）没有租户可限，自动回退到 IP 维度，
 *   否则全站匿名流量会并进一个桶，反而形成新的 DoS 面。
 * - account 维度保留 IP 前缀：登录接口的撞库防护是「同 IP 下再按账号细分」。
 */
export function buildRateLimitKey(input: RateLimitKeyInput): string {
  const route = input.route || ''
  if (input.by === 'tenant' && typeof input.tenantId === 'number' && Number.isFinite(input.tenantId) && input.tenantId > 0) {
    return `${RATE_LIMIT_KEY_PREFIX}${route}:t${input.tenantId}`
  }
  const ip = input.ip || 'unknown'
  const account = input.by === 'account' && input.account ? `:${input.account.trim().toLowerCase()}` : ''
  return `${RATE_LIMIT_KEY_PREFIX}${route}:${ip}${account}`
}
