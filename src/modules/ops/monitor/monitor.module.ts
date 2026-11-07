import { Module } from '@nestjs/common'

import { RedisModule } from '../../../shared/redis/redis.module'
import { MonitorService } from './monitor.service'
import { MonitorV1Controller } from './monitor.v1.controller'

/** 运维监控模块：服务指标实时采集 + Redis 缓存统计/清理（无表） */
@Module({
  imports: [RedisModule],
  controllers: [MonitorV1Controller],
  providers: [MonitorService],
  // 首页概览要复用 getServerInfo（CPU/内存/磁盘），导出服务而不是复制一份采集逻辑
  exports: [MonitorService]
})
export class MonitorModule {}
