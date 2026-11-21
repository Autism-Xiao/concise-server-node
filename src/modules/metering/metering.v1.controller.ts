import { Controller, Get, Query } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'

import { TenantContext } from '../../shared/tenant/tenant.context'
import { ChangeLogService } from '../system/log/change-log.service'
import { MeteringService, usagePeriod } from './metering.service'

/** 租户用量查询：登录即可看自己租户的月度汇总（只是数字，不含具体业务数据） */
@ApiTags('租户用量')
@Controller('v1/metering')
export class MeteringV1Controller {
  constructor(
    private readonly metering: MeteringService,
    private readonly changeLog: ChangeLogService
  ) {}

  @Get('usage')
  @ApiOperation({ summary: '当前租户月度用量', description: '平台管理员需先切到具体租户（X-Tenant-Id）再查询' })
  @ApiQuery({ name: 'period', required: false, description: '账期 YYYYMM，默认当月' })
  async usage(@Query('period') period?: string) {
    const normalized = /^\d{6}$/.test(period ?? '') ? (period as string) : usagePeriod()
    const tenantId = TenantContext.filterTenantId() ?? 0
    // 查询前先落盘：管理端看到的就是此刻最新值，不必等 30 秒定时窗口
    await this.metering.flush()
    return { period: normalized, tenantId, metrics: await this.metering.usage(tenantId, normalized) }
  }

  @Get('quota-changes')
  @ApiOperation({
    summary: '配置（含配额）变更流水',
    description:
      'sys_config 行的字段级变更（含配额上下限、开关），带参数键名与操作人；' +
      '租户视角只含本租户覆盖行，平台视角含全部；configKey 支持模糊（如 tenant.quota）'
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiQuery({ name: 'configKey', required: false, description: '参数键模糊过滤，如 tenant.quota' })
  quotaChanges(@Query() query: { page?: string; pageSize?: string; configKey?: string }) {
    return this.changeLog.listConfigChanges({
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 20,
      configKey: query.configKey
    })
  }
}
