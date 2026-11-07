import type Redis from 'ioredis'

import type { RedisService } from './redis.service'

/**
 * Redis 分布式锁（SET NX PX + token 校验删除）
 *
 * 用途：多实例部署时保证「同一调度周期只有一个实例执行」——
 * 定时任务 cron、提醒巡逻这类触发型任务，各实例都会到点醒来，
 * 拿不到锁的一方直接跳过（不是等待）。
 *
 * 设计要点：
 * - token 用随机值 + Lua 比对删除，防止 A 的锁过期后被 B 抢走、A 执行完误删 B 的锁；
 * - 锁 TTL 必须 > 任务最长执行时间：锁过期后另一个实例可能重复执行一次，
 *   这是「至多一次 + 可能重复」与「宁可漏跑」之间的取舍，调度场景选前者；
 * - Redis 未启用/不可用时返回 true 放行：保持单实例行为不变，不引入新的故障点。
 */

/** 释放锁的原子操作：只有锁的持有者（token 匹配）才能删 */
const UNLOCK_LUA = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end'

/** 尝试获取锁；拿到返回释放函数，拿不到返回 null */
async function tryLock(client: Redis, key: string, token: string, ttlSeconds: number): Promise<() => Promise<void>> {
  const ok = await client.set(key, token, 'EX', ttlSeconds, 'NX')
  if (ok !== 'OK') {
    throw new Error('LOCK_HELD')
  }
  return async () => {
    try {
      await client.eval(UNLOCK_LUA, 1, key, token)
    } catch {
      // 释放失败只意味着锁要等 TTL 自然过期，不影响业务结果
    }
  }
}

/**
 * 在分布式锁内执行 fn。
 * @returns true = 本次持锁执行了 fn；false = 其他实例持有锁，本次跳过
 * Redis 不可用（未启用或命令报错）时无条件执行 fn 并返回 true（单实例语义）。
 */
export async function withRedisLock(
  redis: RedisService | { enabled: boolean; client: Redis | null },
  key: string,
  ttlSeconds: number,
  fn: () => Promise<void> | void
): Promise<boolean> {
  const client = redis.client
  if (!redis.enabled || !client) {
    await fn()
    return true
  }
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`
  let release: (() => Promise<void>) | null
  try {
    release = await tryLock(client, key, token, ttlSeconds)
  } catch (error) {
    if ((error as Error).message !== 'LOCK_HELD') {
      // Redis 抖动：按单实例语义放行，避免调度被缓存故障拖停
      await fn()
      return true
    }
    return false
  }
  try {
    await fn()
    return true
  } finally {
    await release()
  }
}
