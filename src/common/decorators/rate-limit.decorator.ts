import { SetMetadata } from '@nestjs/common'

/** 限流配置元数据 key */
export const RATE_LIMIT_KEY = 'rate_limit'

export interface RateLimitOptions {
  /** 窗口内允许的最大请求数 */
  limit: number
  /** 窗口长度（秒） */
  window: number
  /**
   * 计数维度
   * - ip（默认）：按「来源 IP + 接口」计数，防止单机刷接口
   * - account：按「来源 IP + 接口 + 账号」计数（守卫在 JWT 前，仅登录接口的 body.username 可用）
   * - tenant：按「租户 + 接口」计数，匿名/平台视角回退到 IP；用于租户级 API 配额与恶意租户隔离
   */
  by?: 'ip' | 'account' | 'tenant'
  /** 超限提示文案（默认通用文案） */
  message?: string
}

/**
 * 接口级限流（配合全局 RateLimitGuard）
 *
 * 未标记的接口走全局默认阈值（RATE_LIMIT_LIMIT / RATE_LIMIT_WINDOW，默认 120 次/分钟）。
 * 登录这类高危接口单独收紧，例如：
 * ```ts
 * @RateLimit({ limit: 5, window: 60, by: 'ip', message: '登录请求过于频繁，请稍后再试' })
 * ```
 */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options)
