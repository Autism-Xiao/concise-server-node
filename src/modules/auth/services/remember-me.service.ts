import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'

import { RedisService } from '../../../shared/redis/redis.service'
import { FeatureService } from '../../../shared/feature/feature.service'
import { AuthService } from './auth.service'
import {
  REMEMBER_FALLBACK_TTL,
  REMEMBER_RECORD_PREFIX,
  REMEMBER_USER_INDEX_PREFIX,
  clampRememberDays,
  decodeRememberPayload,
  encodeRememberPayload,
  hashRememberToken
} from './remember-me.util'

/**
 * 「记住登录」凭证（方案 C：Redis 存凭证，密码永不出镜）
 *
 * 与旧版前端 localStorage 存 base64 密码的本质区别：
 * - Redis 只存随机凭证的 SHA-256 与 refresh 链头，**不存任何可逆的密码形态**
 * - 拖库后果 = 一批可吊销的随机 token（revokeUser 一把删），不是全体明文密码
 * - 有效期用 Redis TTL 语义（1-15 天），吊销时机：改密 / 邮件重置（全量下线连带 refresh 链断裂）
 *   / 登出显式吊销 / 换设备（deviceId 不匹配）
 *
 * 续登原理：登录勾选记住时，服务端签发随机凭证并把本次登录的 refreshToken 存入记录；
 * 凭证换取时走 authService.refreshToken 轮换出新的令牌对，再把新 refreshToken 写回记录。
 * 因此改密/封号/管理员重置密码触发的「全量会话下线」会让 refresh 链失效 → 续登自然失败并自愈清理。
 *
 * Redis 未启用或 feature.auth.rememberMe 关闭时：签发静默降级（返回 null），换取一律拒绝（fail-safe）。
 */
@Injectable()
export class RememberMeService {
  private readonly logger = new Logger('RememberMeService')

  constructor(
    private readonly redis: RedisService,
    private readonly featureService: FeatureService,
    private readonly authService: AuthService
  ) {}

  /** 特性开关 + Redis 可用性：两者任一不满足，整套机制视为关闭 */
  private async available(): Promise<boolean> {
    if (!this.redis.enabled) return false
    return this.featureService.enabled('auth.rememberMe')
  }

  /**
   * 登录成功后签发凭证。
   * 任何前置不满足（Redis 关 / 开关关 / 缺 refreshToken）都返回 null，登录本身不受影响。
   */
  async issue(params: { userId: string; deviceId?: string; days?: number; refreshToken: string }): Promise<{ token: string; days: number } | null> {
    if (!(await this.available())) return null
    if (!params.userId || !params.refreshToken) return null

    const client = this.redis.client!
    const days = clampRememberDays(params.days)
    const ttl = days * 24 * 60 * 60
    const token = randomBytes(32).toString('base64url')
    const recordKey = REMEMBER_RECORD_PREFIX + hashRememberToken(token)
    const payload = encodeRememberPayload({
      userId: params.userId,
      deviceId: (params.deviceId ?? '').slice(0, 64),
      refreshToken: params.refreshToken
    })

    await client.setex(recordKey, ttl, payload)
    // 按用户的吊销索引：记录键放进集合，revokeUser 一把全删；集合 TTL 与记录对齐（随最后一次签发续期）
    const indexKey = REMEMBER_USER_INDEX_PREFIX + params.userId
    await client.sadd(indexKey, recordKey)
    await client.expire(indexKey, ttl)
    return { token, days }
  }

  /**
   * 用凭证换新令牌对（免密续登）。
   * 成功 = 走 refreshToken 轮换并把新链头写回记录（TTL 用剩余值，记住窗口不续期）；
   * 失败 = 记录已失效/refresh 链断裂/设备不匹配，删除记录并要求重新登录。
   */
  async exchange(token: string, deviceId?: string): Promise<Record<string, unknown>> {
    if (!(await this.available())) {
      throw new UnauthorizedException('记住登录未启用，请重新登录')
    }
    const client = this.redis.client!
    const recordKey = REMEMBER_RECORD_PREFIX + hashRememberToken(token)
    const raw = await client.get(recordKey)
    if (!raw) {
      throw new UnauthorizedException('登录凭证已失效，请重新登录')
    }
    const payload = decodeRememberPayload(raw)
    if (!payload) {
      await client.del(recordKey)
      throw new UnauthorizedException('登录凭证已损坏，请重新登录')
    }
    // 设备绑定：凭证只对本设备有效，换设备（或凭证被拷走）一律作废
    if (payload.deviceId && deviceId && payload.deviceId !== deviceId) {
      await this.revokeRecord(recordKey, payload.userId)
      throw new UnauthorizedException('登录凭证与当前设备不匹配，请重新登录')
    }

    let result: Record<string, unknown>
    try {
      result = (await this.authService.refreshToken(payload.refreshToken)) as unknown as Record<string, unknown>
    } catch {
      // refresh 链断裂 = 改密/重置/封号等触发了全量下线：凭证跟着作废（吊销语义的主通道）
      await this.revokeRecord(recordKey, payload.userId)
      throw new UnauthorizedException('登录已过期，请重新登录')
    }

    const remain = await client.ttl(recordKey)
    if (result.refreshToken) {
      payload.refreshToken = String(result.refreshToken)
      await client.setex(recordKey, remain > 0 ? remain : REMEMBER_FALLBACK_TTL, encodeRememberPayload(payload))
    } else {
      // 轮换没拿到新链头：记录留着也没用，清掉
      await this.revokeRecord(recordKey, payload.userId)
    }
    return result
  }

  /** 吊销单个凭证（登出时前端带上自己的 token 调用；token 不存在也返回成功，幂等） */
  async revoke(token: string): Promise<void> {
    if (!this.redis.enabled) return
    const client = this.redis.client!
    const recordKey = REMEMBER_RECORD_PREFIX + hashRememberToken(token)
    const raw = await client.get(recordKey).catch(() => null)
    const payload = raw ? decodeRememberPayload(raw) : null
    await this.revokeRecord(recordKey, payload?.userId ?? '')
  }

  /** 吊销某用户的全部凭证（改密/管理员重置密码时调用） */
  async revokeUser(userId: string): Promise<void> {
    if (!this.redis.enabled || !userId) return
    const client = this.redis.client!
    const indexKey = REMEMBER_USER_INDEX_PREFIX + userId
    const members = await client.smembers(indexKey).catch(() => [] as string[])
    if (members.length) await client.del(...members)
    await client.del(indexKey)
    if (members.length) this.logger.log(`已吊销用户 ${userId} 的 ${members.length} 个记住登录凭证`)
  }

  private async revokeRecord(recordKey: string, userId: string): Promise<void> {
    const client = this.redis.client!
    await client.del(recordKey)
    if (userId) await client.srem(REMEMBER_USER_INDEX_PREFIX + userId, recordKey)
  }
}
