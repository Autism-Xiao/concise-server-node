import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiExcludeController, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

import { Perms } from '../../../common/decorators/perms.decorator'
import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { PagerDto } from '../../../common/dto/pager.dto'
import { TaskEntity } from './entities/task.entity'
import { CreateTaskDto } from './dto/create-task.dto'
import { UpdateTaskDto } from './dto/update-task.dto'
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

  @ApiPropertyOptional({ description: '负责人用户 ID 过滤（sys_user.id 字符串主键）', example: '0' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  assigneeId?: string
}

class ChangeStatusDto {
  @ApiProperty({ description: '目标状态：0 待处理 / 1 进行中 / 2 已完成 / 3 已取消', example: 1, enum: [0, 1, 2, 3] })
  @IsIn([0, 1, 2, 3])
  @Type(() => Number)
  status: number
}

// 旧版无前缀接口：仅为向后兼容保留，不出现在 Swagger 文档中（文档只暴露 V1 + 系统分组）
@ApiExcludeController()
@ApiTags('任务管理')
@ApiBearerAuth('jwt')
@Controller('tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @ApiOperation({ summary: '任务分页列表', description: '需 system:task:list' })
  @ApiOkResponse({ description: '分页结果', type: [TaskEntity] })
  @Perms('system:task:list')
  @Get()
  list(@Query() query: QueryTaskDto) {
    return this.taskService.listByQuery(query)
  }

  @ApiOperation({ summary: '任务详情', description: '需 system:task:list' })
  @Perms('system:task:list')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.taskService.findOne(id)
  }

  @ApiOperation({ summary: '创建任务' })
  @OperLog('任务管理')
  @Perms('system:task:add')
  @Post()
  create(@Body() dto: CreateTaskDto) {
    return this.taskService.create(dto)
  }

  @ApiOperation({ summary: '更新任务' })
  @OperLog('任务管理')
  @Perms('system:task:update')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaskDto) {
    return this.taskService.update(id, dto)
  }

  @ApiOperation({ summary: '任务状态流转', description: '待处理→进行中/已取消；进行中→已完成/已取消；已取消→可重开' })
  @OperLog('任务管理')
  @Perms('system:task:update')
  @Put(':id/status')
  changeStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: ChangeStatusDto) {
    return this.taskService.changeStatus(id, dto.status)
  }

  @ApiOperation({ summary: '删除任务' })
  @OperLog('任务管理')
  @Perms('system:task:delete')
  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.taskService.delete(id)
  }
}
