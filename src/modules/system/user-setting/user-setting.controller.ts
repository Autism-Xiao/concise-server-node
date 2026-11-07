import { Body, Controller, Get, Put, Request } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { UpdateUserSettingDto } from './dto/update-user-setting.dto'
import { UserSettingService } from './user-setting.service'

/** 鉴权后 req 上可用的字段（user 由 JwtStrategy 挂载） */
interface AuthedSettingRequest {
  user: { id: string; username?: string }
}

/**
 * 用户界面设置接口
 *
 * 路由刻意写成 `v1/users/me/settings` 而不是 `v1/users/:id/settings`：
 * 设置永远是「我自己的」，不接受别人代改，也就不需要额外的越权判断。
 * 与 UserV1Controller 的 `v1/users/:id` 段数不同，不存在抢占。
 */
@ApiTags('用户设置')
@ApiBearerAuth('jwt')
@Controller('v1/users/me/settings')
export class UserSettingController {
  constructor(private readonly userSettingService: UserSettingService) {}

  @ApiOperation({
    summary: '读取当前用户的界面设置',
    description: '未设置过时 settings 为 null，前端回落到本地默认值；登录即可访问，不需要按钮权限'
  })
  @ApiOkResponse({ description: '{ settings: {...} | null, updatedAt: 时间戳(ms) | null }' })
  @Get()
  get(@Request() req: AuthedSettingRequest) {
    return this.userSettingService.get(req.user.id)
  }

  @ApiOperation({
    summary: '保存当前用户的界面设置（合并语义）',
    description: '只接受白名单键，未知键静默丢弃；与服务端已有值合并后落库，上限 4KB'
  })
  @Put()
  save(@Body() dto: UpdateUserSettingDto, @Request() req: AuthedSettingRequest) {
    return this.userSettingService.save(req.user.id, dto.settings)
  }
}
