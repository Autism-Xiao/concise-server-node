import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
import { BatchUpdateConfigDto, UpdateConfigItemDto } from './dto/config.dto'
import { SystemConfigService } from './system-config.service'

/** 系统参数 v1 接口：/api/v1/configs，按钮权限 system:config:* */
@ApiTags('系统参数')
@ApiBearerAuth('jwt')
@Controller('v1/configs')
export class ConfigV1Controller {
  constructor(private readonly configService: SystemConfigService) {}

  @ApiOperation({ summary: '参数列表', description: '需 system:config:list；可按 group 过滤' })
  @Perms('system:config:list')
  @Get()
  list(@Query('group') group?: string) {
    return this.configService.list(group)
  }

  @ApiOperation({ summary: '参数分组名', description: '需 system:config:list' })
  @Perms('system:config:list')
  @Get('groups')
  groups() {
    return this.configService.groups()
  }

  @ApiOperation({ summary: '修改单个参数', description: '需 system:config:update；值类型按声明校验' })
  @Perms('system:config:update')
  @OperLog('系统参数')
  @Put()
  update(@Body() dto: UpdateConfigItemDto) {
    return this.configService.updateOne(dto)
  }

  @ApiOperation({ summary: '批量修改参数', description: '需 system:config:update；整批校验通过才写' })
  @Perms('system:config:update')
  @OperLog('系统参数')
  @Put('batch')
  updateBatch(@Body() dto: BatchUpdateConfigDto) {
    return this.configService.updateBatch(dto)
  }

  @ApiOperation({ summary: '刷新参数缓存', description: '需 system:config:update；手工改库后调用' })
  @Perms('system:config:update')
  @Post('reload')
  async reload() {
    await this.configService.reload()
    return { reloaded: true }
  }
}
