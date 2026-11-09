import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

import type { UserEntity } from '../../user/entities/user.entity'
import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
import { PagerDto } from '../../../common/dto/pager.dto'
import { Pagination } from '../../../helper/paginate'
import { CreateTaskDto } from './dto/create-task.dto'
import { UpdateTaskDto } from './dto/update-task.dto'
import { TaskEntity } from './entities/task.entity'
import { TaskService } from './task.service'

class QueryTaskDto extends PagerDto {
  @ApiPropertyOptional({ description: '标题模糊过滤', example: '文档' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  keyword?: string

  @ApiPropertyOptional({ description: '优先级过滤：0 低 / 1 中 / 2 高', example: 1, enum: [0, 1, 2] })
  @IsOptional()
  @IsIn([0, 1, 2])
  @Type(() => Number)
  priority?: number

  @ApiPropertyOptional({ description: '状态过滤：0 待处理 / 1 进行中 / 2 已完成 / 3 已取消', example: 0, enum: [0, 1, 2, 3] })
  @IsOptional()
  @IsIn([0, 1, 2, 3])
  @Type(() => Number)
  status?: number

  @ApiPropertyOptional({ description: '负责人用户 ID 过滤（sys_user.id 字符串主键，"0" 为未指派）', example: '0' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  assigneeId?: string
}

class ChangeTaskStatusDto {
  @ApiProperty({ description: '目标状态：0 待处理 / 1 进行中 / 2 已完成 / 3 已取消', example: 1, enum: [0, 1, 2, 3] })
  @IsIn([0, 1, 2, 3])
  @Type(() => Number)
  status: number
}

/**
 * 任务接口 V1：/api/v1/tasks/**
 *
 * 任务表 `task` 的 assignee_id 是 varchar(32)，与 sys_user.id 同型（见迁移 FixTaskAssigneeType），
 * 所以「指派给某人」能真正落到首页概览的 myTasks 统计上。
 * 列表/详情需 system:task:list；mine 只需登录（首页待办下钻、任务页「只看我的」）。
 */
@ApiTags('任务管理 V1')
@ApiBearerAuth('jwt')
@Controller('v1/tasks')
export class TaskV1Controller {
  constructor(private readonly taskService: TaskService) {}

  @ApiOperation({ summary: '我负责的任务（v1）', description: '登录即可访问；按 status 过滤，返回带负责人姓名的分页列表' })
  @ApiOkResponse({ description: '任务分页结果', type: Pagination })
  @Get('mine')
  mine(@Req() req: { user: UserEntity }, @Query() query: QueryTaskDto) {
    return this.taskService.mine(String(req.user.id), { page: query.page, pageSize: query.pageSize, status: query.status })
  }

  @ApiOperation({ summary: '任务分页列表（v1）', description: 'keyword/priority/status/assigneeId 过滤；需 system:task:list' })
  @ApiOkResponse({ description: '任务分页结果', type: Pagination })
  @Perms('system:task:list')
  @Get()
  list(@Query() query: QueryTaskDto) {
    return this.taskService.listByQuery(query)
  }

  @ApiOperation({ summary: '任务详情（v1）', description: '需 system:task:list' })
  @ApiOkResponse({ description: '任务详情', type: TaskEntity })
  @Perms('system:task:list')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.taskService.findOne(id)
  }

  @ApiOperation({ summary: '创建任务（v1）', description: 'assigneeId 必须是存在的用户或 "0"；需 system:task:add' })
  @OperLog('任务管理')
  @Perms('system:task:add')
  @Post()
  create(@Body() dto: CreateTaskDto) {
    return this.taskService.create(dto)
  }

  @ApiOperation({ summary: '更新任务（v1）', description: '需 system:task:update' })
  @OperLog('任务管理')
  @Perms('system:task:update')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaskDto) {
    return this.taskService.update(id, dto)
  }

  @ApiOperation({
    summary: '任务状态流转（v1）',
    description: '待处理→进行中/已取消；进行中→已完成/已取消；已取消→可重开（终态拒绝）；需 system:task:update'
  })
  @OperLog('任务管理')
  @Perms('system:task:update')
  @Put(':id/status')
  changeStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: ChangeTaskStatusDto) {
    return this.taskService.changeStatus(id, dto.status)
  }

  @ApiOperation({ summary: '删除任务（v1）', description: '需 system:task:delete' })
  @OperLog('任务管理')
  @Perms('system:task:delete')
  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.taskService.delete(id)
  }
}
