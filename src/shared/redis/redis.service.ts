import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

/**
 * Redis 服务（支持多实例部署的共享状态载体）
 * REDIS_ENABLED=false 时不建连接，client 为 null，业务方自行降级（如验证码回落内存）
 * enableOfflineQueue=false：连接断开时命令立即报错而不是排队等待，便于业务方快速降级
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  /** 是否启用 Redis */
  readonly enabled: boolean
  /** ioredis 客户端实例；未启用时为 null */
  readonly client: Redis | null

  constructor(configService: ConfigService) {
    this.enabled = configService.get<string>('REDIS_ENABLED') === 'true'
    this.client = this.enabled
      ? new Redis({
          host: configService.get<string>('REDIS_HOST') || '127.0.0.1',
          port: Number(configService.get<string>('REDIS_PORT') || 6379),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
          db: Number(configService.get<string>('REDIS_DB') || 0),
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
