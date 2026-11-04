import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import * as svgCaptcha from 'svg-captcha'

import { BizErrorCode } from '../../../common/enums/biz-error-code.enum'
import { BizException } from '../../../common/exceptions/biz.exception'
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

  /**
   * 校验并销毁（一次性）：MULTI 事务内 GET+DEL 原子执行，并发重放只有首个请求能命中。
   * 校验不通过直接抛 BizException，错误码细分到「参数缺失 / 已过期 / 已被使用 / 内容错误」。
   */
  async assertValid(captchaId?: string, code?: string): Promise<void> {
    if (!captchaId || !code) {
      throw new BizException(BizErrorCode.CAPTCHA_PARAM_INVALID, '请输入验证码')
    }
    const expected = code.trim().toLowerCase()
    const client = this.requireClient()
    const results = (await client
      .multi()
      .get(CAPTCHA_KEY_PREFIX + captchaId)
      .del(CAPTCHA_KEY_PREFIX + captchaId)
      .exec()) as Array<[null, string | number | null]>
    const [, text] = results[0]
    const [, deleted] = results[1]

    if (typeof text !== 'string') {
      // 值为空：已过期（超过 TTL）或这个 captchaId 从未生成过
      throw new BizException(BizErrorCode.CAPTCHA_EXPIRED, '验证码已过期，请重新获取')
    }
    if (!deleted) {
      // 读到了值却删不掉：说明刚被另一个请求消费掉（并发抢用）
      throw new BizException(BizErrorCode.CAPTCHA_ALREADY_USED, '验证码已被使用，请重新获取')
    }
    if (text !== expected) {
      throw new BizException(BizErrorCode.CAPTCHA_INVALID, '验证码错误，请重新获取')
    }
  }

  /** 未启用 Redis 时统一抛业务错误（HTTP 200 + code 503），由前端统一拦截提示 */
  private requireClient() {
    const client = this.redisService.client
    if (!client) {
      throw new BizException(BizErrorCode.SERVICE_UNAVAILABLE, '验证码服务不可用，请检查 Redis 配置（REDIS_ENABLED）')
    }
    return client
  }
}
