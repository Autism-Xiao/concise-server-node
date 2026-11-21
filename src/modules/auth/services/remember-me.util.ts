import { createHash } from 'node:crypto'

/** 记住登录凭证的 Redis 键前缀：record 存凭证记录，user 是按用户的吊销索引（记录键集合） */
export const REMEMBER_RECORD_PREFIX = 'remember:login:'
export const REMEMBER_USER_INDEX_PREFIX = 'remember:login:user:'

/** 记住有效期边界：与前端登录页下拉（1/7/15 天）对齐，超范围一律收敛到边界 */
export const REMEMBER_MIN_DAYS = 1
export const REMEMBER_MAX_DAYS = 15
/** 兜底 TTL（秒）：换取成功但记录 TTL 异常（<=0）时使用，避免记录永久化 */
export const REMEMBER_FALLBACK_TTL = 24 * 60 * 60

/** 有效期收敛：非法值（NaN/0/负数）落到默认 7 天，小数取整，超上限收敛到 15 天 */
export function clampRememberDays(days?: number): number {
  if (!Number.isFinite(days) || (days as number) <= 0) return 7
  return Math.min(Math.max(Math.floor(days as number), REMEMBER_MIN_DAYS), REMEMBER_MAX_DAYS)
}

/** Redis 里只存 token 的 SHA-256：拖库也拿不到可直接使用的凭证 */
export function hashRememberToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 凭证记录载荷：userId / deviceId 用于校验与吊销，refreshToken 是免密续登的链头 */
export interface RememberPayload {
  userId: string
  deviceId: string
  refreshToken: string
}

export function encodeRememberPayload(payload: RememberPayload): string {
  return JSON.stringify(payload)
}

/** 解码失败（脏数据/旧格式/缺关键字段）返回 null，由调用方删除记录 */
export function decodeRememberPayload(raw: string): RememberPayload | null {
  try {
    const data = JSON.parse(raw) as Partial<RememberPayload>
    if (!data.userId || !data.refreshToken) return null
    return { userId: data.userId, deviceId: data.deviceId ?? '', refreshToken: data.refreshToken }
  } catch {
    return null
  }
}
