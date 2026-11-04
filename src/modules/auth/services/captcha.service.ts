import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import * as svgCaptcha from 'svg-captcha'

import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisService } from '../../../shared/redis/redis.service'

/** 验证码在 Redis 中的 key 前缀 */
const CAPTCHA_KEY_PREFIX = 'captcha:'

/**
 * 图形验证码服务（防爆破）
 * 存储只走 Redis（EX 300 自动过期），支持多实例部署；
 * 未启用 Redis（REDIS_ENABLED=false）或 Redis 故障时直接抛业务错误，不做内存降级，
 * 避免多实例间「A 实例生成、B 实例校验」的状态不一致。过期回收交给 Redis EX。
 */
@Injectable()
export class CaptchaService {
  /** 有效期 5 分钟 */
  private readonly ttlSeconds = 300

  constructor(private readonly redisService: RedisService) {}

  /** 生成验证码：返回 SVG 与 captchaId；debug 模式附带明文（仅开发用） */
  async generate(debug = false): Promise<{ captchaId: string; svg: string; code?: string }> {
    const client = this.requireClient()
    const { text, data: svg } = svgCaptcha.create({
      size: 4,
      ignoreChars: 'il1O0o',
      noise: 3,
      color: true,
      background: '#f5f5f5'
    })
    const captchaId = randomUUID()
    await client.set(CAPTCHA_KEY_PREFIX + captchaId, text.toLowerCase(), 'EX', this.ttlSeconds)
    return debug ? { captchaId, svg, code: text } : { captchaId, svg }
  }

  /** 校验并销毁（一次性）：MULTI 事务内 GET+DEL 原子执行，并发重放只有首个请求能命中 */
  async verify(captchaId: string, code: string): Promise<boolean> {
    const expected = code?.trim().toLowerCase()
    if (!captchaId || !expected) {
      return false
    }
    const client = this.requireClient()
    const results = (await client
      .multi()
      .get(CAPTCHA_KEY_PREFIX + captchaId)
      .del(CAPTCHA_KEY_PREFIX + captchaId)
      .exec()) as Array<[null, string | number | null]>
    const [, text] = results[0]
    const [, deleted] = results[1]
    if (!deleted) {
      return false
    }
    return typeof text === 'string' && text === expected
  }

  /** 未启用 Redis 时统一抛业务错误（HTTP 200 + code 503），由前端统一拦截提示 */
  private requireClient() {
    const client = this.redisService.client
    if (!client) {
      throw new BusinessException('验证码服务不可用，请检查 Redis 配置（REDIS_ENABLED）', 503)
    }
    return client
  }
}
