import { Module } from '@nestjs/common'

import { RedisModule } from '../../shared/redis/redis.module'
import { HealthController } from './health.controller'

/**
 * 健康检查模块：GET /api/v1/health（@Public，免鉴权，供 LB/容器探活）
 */
@Module({
  imports: [RedisModule],
  controllers: [HealthController]
})
export class HealthModule {}
