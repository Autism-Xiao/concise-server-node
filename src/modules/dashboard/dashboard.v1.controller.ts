import { Controller, Get, Request } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { DashboardService } from './dashboard.service'
import { DashboardOverview, type DashboardActor } from './dashboard.types'

interface AuthedRequest {
  user?: DashboardActor
}

/**
 * 首页概览接口 V1：/api/v1/dashboard/**
 *
 * 唯一一条路由，**不挂 @Perms**：首页对所有登录用户开放，权限裁剪发生在 service 内部。
 * 原因：同一个页面要按权限显示不同块，用 @Perms 只能在「全有/全 403」之间二选一；
 * 而且低权限用户也该看到自己那部分数据，而不是被整页拦掉。
 */
@ApiTags('首页概览 V1')
@ApiBearerAuth('jwt')
@Controller('v1/dashboard')
export class DashboardV1Controller {
  constructor(private readonly dashboardService: DashboardService) {}

  @ApiOperation({
    summary: '首页概览（v1）',
    description:
      '一次返回首页所有区块，按调用者权限逐块裁剪：无权限的块为 null（不是 0）；登录趋势/最近操作/今日登录在有权限时为全站口径、否则自动降级为「只看自己」，口径见各块的 scope 字段；userTotal 受角色数据范围（data_scope）收窄'
  })
  @ApiOkResponse({ description: '首页聚合数据', type: DashboardOverview })
  @Get('overview')
  overview(@Request() req: AuthedRequest): Promise<DashboardOverview> {
    // JwtAuthGuard 已保证 user 存在（非 @Public 路由）
    return this.dashboardService.overview(req.user as DashboardActor)
  }
}
