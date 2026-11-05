import { Controller, Delete, Get, Param, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
import { QueryOnlineDto } from './dto/query-online.dto'
import { OnlineService } from './online.service'

/**
 * 在线用户接口 V1：/api/v1/online/**
 *
 * JeecgBoot 没有 sys_user_online 表，在线状态存 Redis —— 本项目一致（online:session:*）。
 * 「强制下线」= 删会话 + 写 online:revoked:* 黑名单，JwtStrategy 每次校验都会查黑名单。
 */
@ApiTags('在线用户 V1')
@ApiBearerAuth('jwt')
@Controller('v1/online')
export class OnlineV1Controller {
  constructor(private readonly onlineService: OnlineService) {}

  @ApiOperation({ summary: '在线用户列表（v1）', description: '来自 Redis 实时会话，按登录时间倒序；keyword 模糊匹配账号/部门/IP/浏览器' })
  @Perms('system:online:list')
  @Get()
  list(@Query() query: QueryOnlineDto) {
    return this.onlineService.list(query)
  }

  @ApiOperation({ summary: '在线人数（v1）' })
  @Perms('system:online:list')
  @Get('count')
  count() {
    return this.onlineService.count()
  }

  @ApiOperation({ summary: '强制下线（v1）', description: '按会话编号踢出，令牌进黑名单后该用户后续请求一律 401' })
  @OperLog('在线用户')
  @Perms('system:online:kick')
  @Delete(':sessionId')
  async kick(@Param('sessionId') sessionId: string) {
    await this.onlineService.kick(sessionId)
    return { kicked: 1 }
  }
}
