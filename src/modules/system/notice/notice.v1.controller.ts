import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { IsIn, IsOptional } from 'class-validator'

import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
import { PagerDto } from '../../../common/dto/pager.dto'
import { CreateNoticeDto } from './dto/create-notice.dto'
import { QueryNoticeDto } from './dto/query-notice.dto'
import { UpdateNoticeDto } from './dto/update-notice.dto'
import { SysAnnouncementEntity } from './entities/sys-announcement.entity'
import { NoticeService } from './notice.service'

class QueryPublishedNoticeDto extends PagerDto {
  @ApiPropertyOptional({ description: '消息类型：1 通知公告 / 2 系统消息', example: '1', enum: ['1', '2'] })
  @IsOptional()
  @IsIn(['1', '2'])
  msgCategory?: string
}

/**
 * 通知公告接口 V1：/api/v1/notices/**
 *
 * 表 sys_announcement（对齐 JeecgBoot）：send_status '0' 未发布 / '1' 已发布 / '2' 已撤销；
 * 删除为软删（del_flag='1'）。管理端接口按按钮权限 system:notice:* 控制，
 * /published 面向所有登录用户（登录后即可读已发布公告）。
 */
@ApiTags('通知公告 V1')
@ApiBearerAuth('jwt')
@Controller('v1/notices')
export class NoticeV1Controller {
  constructor(private readonly noticeService: NoticeService) {}

  @ApiOperation({ summary: '已发布公告列表（v1，所有登录用户）', description: '仅返回已发布且处于生效期内的公告，按发布时间倒序' })
  @ApiOkResponse({ description: '分页结果', type: SysAnnouncementEntity })
  @Get('published')
  listPublished(@Query() query: QueryPublishedNoticeDto) {
    return this.noticeService.listPublished(query)
  }

  @ApiOperation({ summary: '公告分页列表（v1，管理端，含未发布与已撤销）' })
  @ApiOkResponse({ description: '分页结果', type: SysAnnouncementEntity })
  @Perms('system:notice:list')
  @Get()
  list(@Query() query: QueryNoticeDto) {
    return this.noticeService.listByQuery(query)
  }

  @ApiOperation({ summary: '公告详情（v1）' })
  @Perms('system:notice:list')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.noticeService.findOneActive(id)
  }

  @ApiOperation({ summary: '创建公告（v1）', description: 'sendStatus=1 时创建即发布并记录发布时间；默认未发布' })
  @OperLog('通知公告')
  @Perms('system:notice:add')
  @Post()
  create(@Body() dto: CreateNoticeDto, @Request() req: { user: { username: string } }) {
    return this.noticeService.createNotice(dto, req.user.username)
  }

  @ApiOperation({ summary: '更新公告（v1）', description: '状态切到已发布时自动补发布时间，切回未发布时清空发布痕迹' })
  @OperLog('通知公告')
  @Perms('system:notice:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNoticeDto, @Request() req: { user: { username: string } }) {
    return this.noticeService.updateNotice(id, dto, req.user.username)
  }

  @ApiOperation({ summary: '发布公告（v1）', description: '未发布/已撤销的公告发布上线；已发布的重复发布会被拒绝' })
  @OperLog('通知公告')
  @Perms('system:notice:publish')
  @Put(':id/publish')
  publish(@Param('id') id: string, @Request() req: { user: { username: string } }) {
    return this.noticeService.publish(id, req.user.username)
  }

  @ApiOperation({ summary: '撤销公告（v1）', description: '仅已发布的公告可撤销，记录撤销时间，状态置为已撤销' })
  @OperLog('通知公告')
  @Perms('system:notice:publish')
  @Put(':id/revoke')
  revoke(@Param('id') id: string, @Request() req: { user: { username: string } }) {
    return this.noticeService.revoke(id, req.user.username)
  }

  @ApiOperation({ summary: '删除公告（v1）', description: '软删除（del_flag=1）；已发布的公告需先撤销' })
  @OperLog('通知公告')
  @Perms('system:notice:delete')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.noticeService.delete(id)
  }
}
