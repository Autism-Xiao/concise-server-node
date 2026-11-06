import { Injectable, Logger } from '@nestjs/common'

import { RedisService } from '../redis/redis.service'

/**
 * 计数结果
 * - count：当前窗口内累计次数
 * - resetAt：窗口到期时间（毫秒时间戳），用于响应 Retry-After
 */
export interface RateLimitHit {
  count: number
  resetAt: number
}

/** 内存兜底条目：Redis 未启用或不可用时使用（单实例内有效） */
interface MemoryEntry {
  count: number
  expiresAt: number
}

/** 内存表超过该条数时做一次过期清理，避免长期运行后无限增长 */
const MEMORY_SWEEP_THRESHOLD = 5000

/**
 * 计数服务（限流与登录失败锁定共用）
 *
 * 设计取舍：
 * - 优先用 Redis：多实例部署时计数共享，重启不清零；KEY 统一带 `rl:` 前缀与 TTL，不会长期堆积。
 * - Redis 未启用/出错时退回进程内 Map：单实例够用，宁可降级也不让限流把业务打挂。
 * - 只提供「自增 + 读 + 删」三个原语，窗口策略交给调用方（固定窗口最简单且足够）。
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name)
  private readonly memory = new Map<string, MemoryEntry>()
  private warned = false

  constructor(private readonly redis: RedisService) {}

  /** 自增一次并返回当前计数；首次自增时设置窗口过期 */
  async increment(key: string, windowSeconds: number): Promise<RateLimitHit> {
    const ttl = Math.max(Math.floor(windowSeconds), 1)
    const client = this.client()
    if (client) {
      try {
        const results = await client.multi().incr(key).ttl(key).exec()
        // ioredis multi().exec() 返回 [err, result][]，空结果视为失败以走降级
        const count = Number((results?.[0]?.[1] as number | undefined) ?? 0)
        const currentTtl = Number((results?.[1]?.[1] as number | undefined) ?? -1)
        if (currentTtl < 0) {
          await client.expire(key, ttl)
          return { count, resetAt: Date.now() + ttl * 1000 }
        }
        return { count, resetAt: Date.now() + currentTtl * 1000 }
      } catch (error) {
        this.warnOnce(`计数写入 Redis 失败，已降级为进程内计数：${(error as Error).message}`)
      }
    }
    return this.incrementMemory(key, ttl)
  }

  /** 读取当前计数（不累加）；不存在返回 0 */
  async get(key: string): Promise<RateLimitHit> {
    const client = this.client()
    if (client) {
      try {
        const results = await client.multi().get(key).ttl(key).exec()
        const raw = results?.[0]?.[1] as string | null | undefined
        const currentTtl = Number((results?.[1]?.[1] as number | undefined) ?? -1)
        return { count: raw ? Number(raw) : 0, resetAt: currentTtl > 0 ? Date.now() + currentTtl * 1000 : 0 }
      } catch (error) {
        this.warnOnce(`计数读取 Redis 失败，已降级为进程内计数：${(error as Error).message}`)
      }
    }
    const entry = this.memory.get(key)
    if (!entry) {
      return { count: 0, resetAt: 0 }
    }
    if (entry.expiresAt <= Date.now()) {
      this.memory.delete(key)
      return { count: 0, resetAt: 0 }
    }
    return { count: entry.count, resetAt: entry.expiresAt }
  }

  /** 清零（登录成功后重置失败计数、手动解锁） */
  async reset(key: string): Promise<void> {
    this.memory.delete(key)
    const client = this.client()
    if (!client) return
    try {
      await client.del(key)
    } catch (error) {
      this.warnOnce(`计数清理 Redis 失败：${(error as Error).message}`)
    }
  }

  /** 进程内自增（含惰性过期清理） */
  private incrementMemory(key: string, ttl: number): RateLimitHit {
    const now = Date.now()
    if (this.memory.size > MEMORY_SWEEP_THRESHOLD) {
      for (const [entryKey, entry] of this.memory) {
        if (entry.expiresAt <= now) {
          this.memory.delete(entryKey)
        }
      }
    }
    const current = this.memory.get(key)
    if (!current || current.expiresAt <= now) {
      const entry: MemoryEntry = { count: 1, expiresAt: now + ttl * 1000 }
      this.memory.set(key, entry)
      return { count: 1, resetAt: entry.expiresAt }
    }
    current.count += 1
    return { count: current.count, resetAt: current.expiresAt }
  }

  private client() {
    return this.redis.enabled ? this.redis.client : null
  }

  private warnOnce(message: string): void {
    if (this.warned) return
    this.warned = true
    this.logger.warn(message)
  }
}
