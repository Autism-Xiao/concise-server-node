import { Controller, Delete, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'

import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
import { MonitorService } from './monitor.service'

class ClearCacheDto {
  @ApiPropertyOptional({ description: '只清理该前缀（如 online:session:）；不传则清理本项目全部缓存前缀' })
  @IsOptional()
  @IsString()
  prefix?: string
}

/**
 * 运维监控接口 V1：/api/v1/monitor/**
 *
 * 服务监控/缓存监控都不落表，是实时采集；本项目一致，不落库。
 */
@ApiTags('运维监控 V1')
@ApiBearerAuth('jwt')
@Controller('v1/monitor')
export class MonitorV1Controller {
  constructor(private readonly monitorService: MonitorService) {}

  @ApiOperation({ summary: '服务监控（v1）', description: '主机/CPU/内存/Node 进程/磁盘实时指标' })
  @Perms('system:monitor:server')
  @Get('server')
  server() {
    return this.monitorService.getServerInfo()
  }

  @ApiOperation({ summary: '缓存监控（v1）', description: 'Redis INFO + 按 key 前缀统计数量与 TTL' })
  @Perms('system:monitor:cache')
  @Get('cache')
  cache() {
    return this.monitorService.getCacheInfo()
  }

  @ApiOperation({ summary: '清理缓存（v1）', description: '按前缀删除 key；不传 prefix 只清本项目前缀（在线会话/黑名单/验证码）' })
  @ApiQuery({ name: 'prefix', required: false })
  @OperLog('运维监控')
  @Perms('system:monitor:cache:clear')
  @Delete('cache')
  clear(@Query() query: ClearCacheDto) {
    return this.monitorService.clearCache(query.prefix)
  }
}
