import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import * as svgCaptcha from 'svg-captcha'

interface CaptchaEntry {
  text: string
  expiresAt: number
}

/**
 * 图形验证码服务（防爆破）
 * 内存存储：单实例够用；接入 Redis 后把 store 换成 Redis 即可支持多实例
 * 验证一次性：无论成败验证后立即销毁，防止重放
 */
@Injectable()
export class CaptchaService {
  private readonly store = new Map<string, CaptchaEntry>()
  /** 有效期 5 分钟 */
  private readonly ttl = 5 * 60 * 1000
  /** 上限防内存膨胀 */
  private readonly maxStore = 10000

  /** 生成验证码：返回 SVG 与 captchaId；debug 模式附带明文（仅开发用） */
  generate(debug = false): { captchaId: string; svg: string; code?: string } {
    const { text, data: svg } = svgCaptcha.create({
      size: 4,
      ignoreChars: 'il1O0o',
      noise: 3,
      color: true,
      background: '#f5f5f5'
    })
    const captchaId = randomUUID()
    // 超限清理最旧的一半，避免内存无限增长
    if (this.store.size >= this.maxStore) {
      const keys = [...this.store.keys()].slice(0, Math.floor(this.maxStore / 2))
      for (const key of keys) {
        this.store.delete(key)
      }
    }
    this.store.set(captchaId, { text: text.toLowerCase(), expiresAt: Date.now() + this.ttl })
    return debug ? { captchaId, svg, code: text } : { captchaId, svg }
  }

  /** 校验并销毁（一次性） */
  verify(captchaId: string, code: string): boolean {
    const entry = captchaId ? this.store.get(captchaId) : undefined
    if (captchaId) {
      this.store.delete(captchaId)
    }
    if (!entry || Date.now() > entry.expiresAt) {
      return false
    }
    return entry.text === code.trim().toLowerCase()
  }

  /** 清理过期项（每次生成时顺带执行） */
  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key)
      }
    }
  }
}
