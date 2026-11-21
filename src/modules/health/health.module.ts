import { Module } from '@nestjs/common'

import { RedisModule } from '../../shared/redis/redis.module'
import { HealthController } from './health.controller'
import { MetricsController } from './metrics.controller'

/**
 * 健康检查模块：GET /api/v1/health（@Public，免鉴权，供 LB/容器探活）
 * 指标端点：GET /api/v1/metrics（@Public，可选 METRICS_TOKEN，供 Prometheus 抓取）
 */
@Module({
  imports: [RedisModule],
  controllers: [HealthController, MetricsController]
})
export class HealthModule {}
