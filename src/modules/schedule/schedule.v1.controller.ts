import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Request } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../common/decorators/oper-log.decorator'
import { CreateCalendarDto, UpdateCalendarDto } from './dto/create-calendar.dto'
import { CreateScheduleEventDto, QueryScheduleEventDto, UpdateScheduleEventDto } from './dto/create-event.dto'
import { BaseCalendarEntity } from './entities/base-calendar.entity'
import { BaseScheduleEventEntity } from './entities/base-schedule-event.entity'
import { ScheduleService } from './schedule.service'

/** 请求上下文中的当前用户（JwtStrategy 校验后注入，id 为 bigint 字符串） */
interface AuthedRequest {
  user: { id: string | number; username: string }
}

/**
 * 日历管理接口 V1：/api/v1/schedule/**
 * 个人日程功能，所有登录用户可用（写操作在 service 层校验属主，不挂按钮权限码）。
 */
@ApiTags('日历管理 V1')
@ApiBearerAuth('jwt')
@Controller('v1/schedule')
export class ScheduleV1Controller {
  constructor(private readonly scheduleService: ScheduleService) {}

  /* ---------- 日历分类 ---------- */

  @ApiOperation({ summary: '日历列表', description: '返回我的日历 + 公开日历' })
  @ApiOkResponse({ description: '日历列表', type: [BaseCalendarEntity] })
  @Get('calendars')
  listCalendars(@Request() req: AuthedRequest) {
    return this.scheduleService.listCalendars(String(req.user.id))
  }

  @ApiOperation({ summary: '新建日历' })
  @ApiOkResponse({ description: '创建后的日历', type: BaseCalendarEntity })
  @OperLog('日历管理')
  @Post('calendars')
  createCalendar(@Request() req: AuthedRequest, @Body() dto: CreateCalendarDto) {
    return this.scheduleService.createCalendar(String(req.user.id), dto)
  }

  @ApiOperation({ summary: '更新日历' })
  @ApiOkResponse({ description: '更新后的日历', type: BaseCalendarEntity })
  @OperLog('日历管理')
  @Put('calendars/:id')
  updateCalendar(@Request() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCalendarDto) {
    return this.scheduleService.updateCalendar(String(req.user.id), id, dto)
  }

  @ApiOperation({ summary: '删除日历（级联删除日程并取消提醒）' })
  @OperLog('日历管理')
  @Delete('calendars/:id')
  deleteCalendar(@Request() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.scheduleService.deleteCalendar(String(req.user.id), id)
  }

  @ApiOperation({ summary: '确保默认日历（无日历时自动创建「我的日程」，返回日历实体）' })
  @ApiOkResponse({ description: '默认日历', type: BaseCalendarEntity })
  @Post('calendars/ensure-default')
  ensureDefaultCalendar(@Request() req: AuthedRequest) {
    return this.scheduleService.ensureDefaultCalendar(String(req.user.id))
  }

  /* ---------- 日程事件 ---------- */

  @ApiOperation({ summary: '日程区间查询', description: 'startDate/endDate 过滤事件区间（月视图用），按开始时间升序' })
  @ApiOkResponse({ description: '日程列表', type: [BaseScheduleEventEntity] })
  @Get('events')
  listEvents(@Request() req: AuthedRequest, @Query() dto: QueryScheduleEventDto) {
    return this.scheduleService.listEvents(String(req.user.id), dto)
  }

  @ApiOperation({ summary: '日程详情' })
  @ApiOkResponse({ description: '日程详情', type: BaseScheduleEventEntity })
  @Get('events/:id')
  getEvent(@Request() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.scheduleService.getEvent(String(req.user.id), id)
  }

  @ApiOperation({ summary: '创建日程', description: 'remindAt 早于当前时间时由巡逻立即补发一次提醒' })
  @ApiOkResponse({ description: '创建后的日程', type: BaseScheduleEventEntity })
  @OperLog('日历管理')
  @Post('events')
  createEvent(@Request() req: AuthedRequest, @Body() dto: CreateScheduleEventDto) {
    return this.scheduleService.createEvent(String(req.user.id), dto)
  }

  @ApiOperation({ summary: '修改日程', description: '时间/提醒变化时重置提醒并重新注册；remindAt 传 null 取消提醒' })
  @ApiOkResponse({ description: '修改后的日程', type: BaseScheduleEventEntity })
  @OperLog('日历管理')
  @Put('events/:id')
  updateEvent(@Request() req: AuthedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateScheduleEventDto) {
    return this.scheduleService.updateEvent(String(req.user.id), id, dto)
  }

  @ApiOperation({ summary: '删除日程（同步取消提醒）' })
  @OperLog('日历管理')
  @Delete('events/:id')
  deleteEvent(@Request() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.scheduleService.deleteEvent(String(req.user.id), id)
  }
}
