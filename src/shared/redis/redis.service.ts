import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import Redis from 'ioredis'

import { redisConfig, type RedisConfig } from '../../config'

/**
 * Redis 服务（支持多实例部署的共享状态载体）
 * REDIS_ENABLED=false 时不建连接，client 为 null，业务方自行降级（如验证码回落内存）
 * enableOfflineQueue=false：连接断开时命令立即报错而不是排队等待，便于业务方快速降级
 *
 * 配置来源：src/config/redis.config.ts（redis.* 命名空间），此处只负责「用配置建连接」，
 * 类型转换（布尔/数字/空密码）在配置层完成。
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  /** 是否启用 Redis */
  readonly enabled: boolean
  /** ioredis 客户端实例；未启用时为 null */
  readonly client: Redis | null

  constructor(@Inject(redisConfig.KEY) config: RedisConfig) {
    this.enabled = config.enabled
    this.client = this.enabled
      ? new Redis({
          host: config.host,
          port: config.port,
          password: config.password,
          db: config.db,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          retryStrategy: times => Math.min(times * 200, 3000)
        })
      : null
  }

  onModuleDestroy(): void {
    this.client?.disconnect()
  }
}
