import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Request } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../common/decorators/oper-log.decorator'
import { Perms } from '../../common/decorators/perms.decorator'
import { QueryMessageDto, QueryMyMessageDto, SendMessageDto } from './dto/message.dto'
import { MessageService } from './message.service'

/**
 * 站内信 v1 接口
 *
 * 两组路由：
 * - 管理端（/v1/messages）：发送、发送记录、删除，挂 system:message:* 按钮权限；
 * - 个人端（/v1/messages/mine 等）：登录即可用，红点与已读不需要管理权限。
 * 注意：mine / unread-count / read-all 必须声明在 :id 之前，否则被参数路由吞掉。
 */
@ApiTags('系统 - 站内信')
@ApiBearerAuth('jwt')
@Controller('v1/messages')
export class MessageV1Controller {
  constructor(private readonly messageService: MessageService) {}

  // ---------- 管理端 ----------

  @ApiOperation({ summary: '发送站内信', description: '需 system:message:send；接收人过滤到真实存在账号' })
  @Perms('system:message:send')
  @OperLog('站内信')
  @Post()
  send(@Body() dto: SendMessageDto, @Request() req: { user?: { id: string } }) {
    return this.messageService.send(dto, req.user?.id)
  }

  @ApiOperation({ summary: '发送记录分页', description: '需 system:message:list' })
  @Perms('system:message:list')
  @Get()
  list(@Query() query: QueryMessageDto) {
    return this.messageService.list(query)
  }

  @ApiOperation({ summary: '消息接收人已读情况', description: '需 system:message:list' })
  @Perms('system:message:list')
  @Get(':id/receivers')
  receivers(@Param('id') id: string) {
    return this.messageService.receivers(id)
  }

  @ApiOperation({ summary: '删除发送记录', description: '需 system:message:delete；连同接收人关联一起删' })
  @Perms('system:message:delete')
  @OperLog('站内信')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.messageService.remove(id)
  }

  // ---------- 个人端（登录即可） ----------

  @ApiOperation({ summary: '我的消息分页', description: '登录即可；unread=1 只看未读' })
  @Get('mine')
  mine(@Query() query: QueryMyMessageDto, @Request() req: { user?: { id: string } }) {
    return this.messageService.mine(req.user?.id ?? '', query)
  }

  @ApiOperation({ summary: '我的未读数', description: '登录即可；顶栏红点数据源' })
  @Get('unread-count')
  unreadCount(@Request() req: { user?: { id: string } }) {
    return this.messageService.unreadCount(req.user?.id ?? '')
  }

  @ApiOperation({ summary: '全部已读', description: '登录即可' })
  @Put('read-all')
  @HttpCode(200)
  readAll(@Request() req: { user?: { id: string } }) {
    return this.messageService.markAllRead(req.user?.id ?? '')
  }

  @ApiOperation({ summary: '标记单条已读', description: '登录即可；只能标记发给自己的消息' })
  @Put(':id/read')
  @HttpCode(200)
  read(@Param('id') id: string, @Request() req: { user?: { id: string } }) {
    return this.messageService.markRead(req.user?.id ?? '', id)
  }
}
