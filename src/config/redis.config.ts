import { registerAs, type ConfigType } from '@nestjs/config'

import { env, envBoolean, envNumber } from '../global/env'

/**
 * Redis 配置命名空间（redis.*）
 *
 * 职责：把 REDIS_* 环境变量一次性转成正确类型（布尔/数字/可空密码），
 * 业务侧只拿结构体，不再出现 `get('REDIS_ENABLED') === 'true'` 这类字符串比较和 Number() 转换。
 *
 * REDIS_ENABLED=false 时不建立连接（client 为 null），需要 Redis 的业务方自行降级。
 */
export const redisConfig = registerAs('redis', () => ({
  /** 是否启用 Redis（false 时不建连接） */
  enabled: envBoolean('REDIS_ENABLED', false),
  host: env('REDIS_HOST', '127.0.0.1'),
  port: envNumber('REDIS_PORT', 6379),
  /** 空字符串视为无密码，转成 undefined 传给 ioredis */
  password: env('REDIS_PASSWORD') || undefined,
  db: envNumber('REDIS_DB', 0)
}))

export type RedisConfig = ConfigType<typeof redisConfig>
