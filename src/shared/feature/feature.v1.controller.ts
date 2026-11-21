import { Controller, Get } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { FeatureService } from '../../shared/feature/feature.service'

@ApiTags('特性开关')
@ApiBearerAuth('jwt')
@Controller('v1/features')
export class FeatureV1Controller {
  constructor(private readonly featureService: FeatureService) {}

  @ApiOperation({ summary: '当前租户视角的全部生效开关', description: '键不含 feature. 前缀；前端拉取后按 flag 控制界面能力展示' })
  @Get()
  list(): Promise<Record<string, boolean>> {
    return this.featureService.listAll()
  }
}
