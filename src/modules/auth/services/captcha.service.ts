import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import * as svgCaptcha from 'svg-captcha'

import { RedisService } from '../../../shared/redis/redis.service'

/** 验证码在 Redis 中的 key 前缀 */
const CAPTCHA_KEY_PREFIX = 'captcha:'

interface CaptchaEntry {
  text: string
  expiresAt: number
}

/**
 * 图形验证码服务（防爆破）
 * 存储策略：REDIS_ENABLED=true 时写入 Redis（EX 300 过期），支持多实例部署；
 * Redis 未启用或读写失败时自动降级为进程内存 Map（仅单实例有效，重启即失效）
 * 验证一次性：无论成败验证后立即销毁，防止重放
 */
@Injectable()
export class CaptchaService {
  /** 内存兜底存储：Redis 不可用时降级使用 */
  private readonly memoryStore = new Map<string, CaptchaEntry>()
  /** 有效期 5 分钟 */
  private readonly ttlSeconds = 300
  /** 内存兜底的上限防膨胀 */
  private readonly maxStore = 10000

  constructor(private readonly redisService: RedisService) {}

  /** 生成验证码：返回 SVG 与 captchaId；debug 模式附带明文（仅开发用） */
  async generate(debug = false): Promise<{ captchaId: string; svg: string; code?: string }> {
    const { text, data: svg } = svgCaptcha.create({
      size: 4,
      ignoreChars: 'il1O0o',
      noise: 3,
      color: true,
      background: '#f5f5f5'
    })
    const captchaId = randomUUID()
    const saved = await this.saveToRedis(captchaId, text.toLowerCase())
    if (!saved) {
      this.trimMemoryStore()
      this.memoryStore.set(captchaId, { text: text.toLowerCase(), expiresAt: Date.now() + this.ttlSeconds * 1000 })
    }
    return debug ? { captchaId, svg, code: text } : { captchaId, svg }
  }

  /** 校验并销毁（一次性） */
  async verify(captchaId: string, code: string): Promise<boolean> {
    const expected = code?.trim().toLowerCase()
    if (!captchaId || !expected) {
      return false
    }
    if (this.redisService.client) {
      try {
        // MULTI 事务内 GET + DEL 原子执行，保证一次性：并发校验只有首个请求能拿到值
        const results = (await this.redisService.client
          .multi()
          .get(CAPTCHA_KEY_PREFIX + captchaId)
          .del(CAPTCHA_KEY_PREFIX + captchaId)
          .exec()) as Array<[null, string | number | null]>
        const [, text] = results[0]
        const [, deleted] = results[1]
        if (deleted) {
          return typeof text === 'string' && text === expected
        }
        // key 不在 Redis（生成时曾降级到内存），继续走内存校验
      } catch (error) {
        console.error('[CaptchaService] Redis 校验失败，降级内存校验:', error)
      }
    }
    return this.verifyMemory(captchaId, expected)
  }

  /** 写入 Redis；未启用或失败返回 false 交由调用方降级 */
  private async saveToRedis(captchaId: string, text: string): Promise<boolean> {
    if (!this.redisService.client) {
      return false
    }
    try {
      await this.redisService.client.set(CAPTCHA_KEY_PREFIX + captchaId, text, 'EX', this.ttlSeconds)
      return true
    } catch (error) {
      console.error('[CaptchaService] Redis 写入失败，降级内存存储:', error)
      return false
    }
  }

  /** 内存模式校验：取出即销毁（一次性） */
  private verifyMemory(captchaId: string, expected: string): boolean {
    const entry = this.memoryStore.get(captchaId)
    this.memoryStore.delete(captchaId)
    if (!entry || Date.now() > entry.expiresAt) {
      return false
    }
    return entry.text === expected
  }

  /** 超限清理最旧的一半，避免内存无限增长 */
  private trimMemoryStore(): void {
    if (this.memoryStore.size < this.maxStore) {
      return
    }
    const keys = [...this.memoryStore.keys()].slice(0, Math.floor(this.maxStore / 2))
    for (const key of keys) {
      this.memoryStore.delete(key)
    }
  }
}
