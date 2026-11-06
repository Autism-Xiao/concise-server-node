import { Body, Controller, Get, Param, Put, Request } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
import { UserService } from '../../user/user.service'
import { UpdateMyWatermarkDto } from './dto/update-my-watermark.dto'
import { UpdateUserWatermarkDto } from './dto/update-user-watermark.dto'
import { UpdateWatermarkSettingDto } from './dto/update-watermark-setting.dto'
import { WatermarkService, type WatermarkUserLike } from './watermark.service'

/** 鉴权后 req 上可用的字段（user 由 JwtStrategy 挂载） */
interface AuthedWatermarkRequest {
  user: WatermarkUserLike
  ip?: string
}

/**
 * 页面水印接口
 *
 * 路由都挂在 /api/v1 下，但刻意做成一个控制器而不是两个：
 * `PUT users/me/watermark` 与 `PUT users/:id/watermark` 段数相同，
 * 必须靠「me 先声明」来保证 `me` 不被当成用户 ID 去查库。
 */
@ApiTags('页面水印')
@ApiBearerAuth('jwt')
@Controller('v1')
export class WatermarkController {
  constructor(
    private readonly watermarkService: WatermarkService,
    private readonly userService: UserService
  ) {}

  @ApiOperation({
    summary: '获取当前用户的生效水印配置',
    description: '返回最终是否显示、已解析好占位符的文本行、样式参数与可编辑态。前端只负责按 lines 绘制，不再做任何字符串替换'
  })
  @ApiOkResponse({ description: '生效水印配置（enabled/lines/density/opacity/rotate/fontSize/editable/reason）' })
  @Get('users/me/watermark')
  me(@Request() req: AuthedWatermarkRequest) {
    return this.watermarkService.resolve(req.user, req.ip)
  }

  @ApiOperation({
    summary: '修改当前用户的水印',
    description: '仅接受 enabled / content / density；被管理员强制开关时返回业务错误并附带原因'
  })
  @OperLog('页面水印')
  @Put('users/me/watermark')
  updateMine(@Body() dto: UpdateMyWatermarkDto, @Request() req: AuthedWatermarkRequest) {
    return this.watermarkService.updateMine(req.user, dto, req.ip)
  }

  @ApiOperation({
    summary: '管理员设置指定用户的水印',
    description: 'enforced=1 强制开启（用户关不掉）、2 强制关闭（用户开不了）、0 恢复按全局策略；需 system:user:update'
  })
  @Perms('system:user:update')
  @OperLog('页面水印')
  @Put('users/:id/watermark')
  async updateForUser(@Param('id') id: string, @Body() dto: UpdateUserWatermarkDto, @Request() req: AuthedWatermarkRequest) {
    // 先确认用户存在，避免给不存在的 id 写出孤儿配置行
    await this.userService.findOne(id)
    return this.watermarkService.updateForUser(id, dto, req.user.username)
  }

  @ApiOperation({ summary: '读取全局水印策略', description: '默认开关、策略模式、默认文案与样式参数；需 system:watermark:edit' })
  @Perms('system:watermark:edit')
  @Get('system/watermark')
  getSetting() {
    return this.watermarkService.getSetting()
  }

  @ApiOperation({ summary: '修改全局水印策略', description: 'enabled 与 mode 自动联动；需 system:watermark:edit' })
  @Perms('system:watermark:edit')
  @OperLog('页面水印')
  @Put('system/watermark')
  updateSetting(@Body() dto: UpdateWatermarkSettingDto, @Request() req: AuthedWatermarkRequest) {
    return this.watermarkService.updateSetting(dto, req.user.username)
  }
}
