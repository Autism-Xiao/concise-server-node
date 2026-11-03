import { Body, Controller, Delete, Get, Param, ParseIntPipe, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayNotEmpty, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator'

import { Perms } from '../../../common/decorators/perms.decorator'
import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { PagerDto } from '../../../common/dto/pager.dto'
import { LogService } from './log.service'
import { LoginLogEntity } from './entities/login-log.entity'
import { OperLogEntity } from './entities/oper-log.entity'

class QueryLoginLogDto extends PagerDto {
  @ApiPropertyOptional({ description: '用户名模糊过滤', example: 'admin' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  username?: string

  @ApiPropertyOptional({ description: '结果过滤：0 失败 / 1 成功', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsIn([0, 1])
  @Type(() => Number)
  status?: number

  @ApiPropertyOptional({ description: '起始时间（ISO 8601，含）', example: '2026-11-01T00:00:00Z' })
  @IsOptional()
  @IsDateString({}, { message: 'startTime 须为 ISO 8601 日期' })
  startTime?: string

  @ApiPropertyOptional({ description: '结束时间（ISO 8601，含）', example: '2026-11-30T23:59:59Z' })
  @IsOptional()
  @IsDateString({}, { message: 'endTime 须为 ISO 8601 日期' })
  endTime?: string
}

class QueryOperLogDto extends PagerDto {
  @ApiPropertyOptional({ description: '操作人用户名模糊过滤', example: 'admin' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  username?: string

  @ApiPropertyOptional({ description: '模块名模糊过滤', example: '用户管理' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  module?: string

  @ApiPropertyOptional({ description: '起始时间（ISO 8601，含）', example: '2026-11-01T00:00:00Z' })
  @IsOptional()
  @IsDateString({}, { message: 'startTime 须为 ISO 8601 日期' })
  startTime?: string

  @ApiPropertyOptional({ description: '结束时间（ISO 8601，含）', example: '2026-11-30T23:59:59Z' })
  @IsOptional()
  @IsDateString({}, { message: 'endTime 须为 ISO 8601 日期' })
  endTime?: string
}

class DeleteLogsDto {
  @ApiProperty({ description: '要删除的日志 ID 列表', example: [1, 2] })
  @IsArray()
  @ArrayNotEmpty({ message: 'ids 不能为空' })
  @IsInt({ each: true })
  ids: number[]
}

@ApiTags('日志管理')
@ApiBearerAuth('jwt')
@Controller('logs')
export class LogController {
  constructor(private readonly logService: LogService) {}

  @ApiOperation({ summary: '登录日志分页列表', description: '支持用户名/结果/时间范围过滤' })
  @ApiOkResponse({ description: '登录日志分页', type: LoginLogEntity })
  @Perms('system:log:login')
  @Get('login')
  listLoginLog(@Query() query: QueryLoginLogDto) {
    return this.logService.listLoginLog(query)
  }

  @ApiOperation({ summary: '登录日志详情' })
  @Perms('system:log:login')
  @Get('login/:id')
  findLoginLog(@Param('id', ParseIntPipe) id: number) {
    return this.logService.findLoginLog(id)
  }

  @ApiOperation({ summary: '操作日志分页列表', description: '支持操作人/模块/时间范围过滤' })
  @ApiOkResponse({ description: '操作日志分页', type: OperLogEntity })
  @Perms('system:log:oper')
  @Get('oper')
  listOperLog(@Query() query: QueryOperLogDto) {
    return this.logService.listOperLog(query)
  }

  @ApiOperation({ summary: '操作日志详情' })
  @Perms('system:log:oper')
  @Get('oper/:id')
  findOperLog(@Param('id', ParseIntPipe) id: number) {
    return this.logService.findOperLog(id)
  }

  @ApiOperation({ summary: '批量删除登录日志' })
  @OperLog('日志管理')
  @Perms('system:log:delete')
  @Delete('login')
  removeLoginLogs(@Body() dto: DeleteLogsDto) {
    return this.logService.removeLoginLogs(dto.ids)
  }

  @ApiOperation({ summary: '批量删除操作日志' })
  @OperLog('日志管理')
  @Perms('system:log:delete')
  @Delete('oper')
  removeOperLogs(@Body() dto: DeleteLogsDto) {
    return this.logService.removeOperLogs(dto.ids)
  }
}
