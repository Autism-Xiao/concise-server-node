import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common'
import type { Response } from 'express'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { DataSource } from 'typeorm'

import { Public } from '../../common/decorators/public.decorator'
import { RedisService } from '../../shared/redis/redis.service'

/**
 * 健康检查（负载均衡 / 容器探活目标）。
 *
 * - db：必须健康，失败返回 503（应用不可用）
 * - redis：降级视图——未启用返回 'skipped'，启用但 ping 失败不置 503（业务方各自降级），
 *   但暴露状态便于监控告警
 */
@ApiTags('系统 V1 · 健康')
@Controller('v1/health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(RedisService) private readonly redisService: RedisService
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: '健康检查（DB 必须、Redis 降级视图）' })
  async check(@Res() res: Response) {
    const result: {
      status: 'ok' | 'degraded'
      db: boolean
      redis: 'ok' | 'down' | 'skipped'
      uptime: number
      timestamp: string
    } = {
      status: 'ok',
      db: false,
      redis: this.redisService.enabled ? 'down' : 'skipped',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    }

    // DB：SELECT 1 走连接池，拿不到连接即视为不健康
    try {
      await this.dataSource.query('SELECT 1')
      result.db = true
    } catch {
      result.db = false
    }

    // Redis：启用才探测；失败只降级状态不失败接口（与业务降级策略一致）
    if (this.redisService.enabled && this.redisService.client) {
      try {
        await this.redisService.client.ping()
        result.redis = 'ok'
      } catch {
        result.redis = 'down'
      }
    }

    if (!result.db) {
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json(result)
    }
    return res.status(HttpStatus.OK).json(result)
  }
}
