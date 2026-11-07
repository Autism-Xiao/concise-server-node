import { Module } from '@nestjs/common'

import { MonitorModule } from '../ops/monitor/monitor.module'
import { OnlineModule } from '../ops/online/online.module'
import { UserModule } from '../user/user.module'
import { DashboardService } from './dashboard.service'
import { DashboardV1Controller } from './dashboard.v1.controller'

/**
 * 首页概览模块
 *
 * 只做聚合，不建表、不写数据：
 *  - UserModule   → countScoped（复用 sys_role.data_scope 部门范围）
 *  - OnlineModule → 在线人数（Redis 实时会话）
 *  - MonitorModule→ CPU/内存/磁盘（os API 实时采集）
 *  - sys_log / task / sys_file / sys_announcement 直接用 DataSource 跑聚合 SQL，
 *    不绕各业务 Service（那些方法都是"分页列表"，当统计用等于拖全表）
 *
 * PermissionCacheService 来自 @Global 的 PermissionCacheModule，无需 imports。
 */
@Module({
  imports: [UserModule, OnlineModule, MonitorModule],
  controllers: [DashboardV1Controller],
  providers: [DashboardService]
})
export class DashboardModule {}
