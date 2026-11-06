import { Controller, Get, Param, ParseIntPipe, Put, Query, Request } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator'

import { Pagination } from '../../helper/paginate'
import { ScheduleService } from './schedule.service'

class QueryReminderDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  current: number = 1

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size: number = 20

  @ApiPropertyOptional({ description: '未读筛选：true=仅未读，false=仅已读，不传=全部' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isRead?: boolean
}

/** 站内提醒消息接口 V1：/api/v1/schedule/reminder/** */
@ApiTags('日历管理 V1')
@ApiBearerAuth('jwt')
@Controller('v1/schedule/reminder')
export class ReminderV1Controller {
  constructor(private readonly scheduleService: ScheduleService) {}

  @ApiOperation({ summary: '提醒消息列表（分页，支持未读筛选）' })
  @ApiOkResponse({ description: '提醒消息分页', type: Pagination })
  @Get('list')
  list(@Request() req: { user: { id: string | number } }, @Query() dto: QueryReminderDto) {
    return this.scheduleService.listReminders(String(req.user.id), { current: dto.current, size: dto.size, isRead: dto.isRead })
  }

  @ApiOperation({ summary: '未读消息数量（顶部红点）' })
  @Get('unread-count')
  unreadCount(@Request() req: { user: { id: string | number } }) {
    return this.scheduleService.unreadCount(String(req.user.id))
  }

  @ApiOperation({ summary: '全部标记已读' })
  @Put('read-all')
  markAllRead(@Request() req: { user: { id: string | number } }) {
    return this.scheduleService.markAllRead(String(req.user.id))
  }

  @ApiOperation({ summary: '标记单条消息已读' })
  @Put(':id/read')
  markRead(@Request() req: { user: { id: string | number } }, @Param('id', ParseIntPipe) id: number) {
    return this.scheduleService.markRead(String(req.user.id), id)
  }
}
