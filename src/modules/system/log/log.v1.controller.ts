import { Body, Controller, Delete, Get, Param, Query, Res, StreamableFile } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { Type } from 'class-transformer'
import { ArrayNotEmpty, IsArray, IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

import { Perms } from '../../../common/decorators/perms.decorator'
import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { PagerDto } from '../../../common/dto/pager.dto'
import { formatDateTime } from '../../../utils/csv.util'
import { buildXlsx } from '../../../utils/xlsx.util'
import { LogService } from './log.service'
import { SysLogEntity } from './entities/sys-log.entity'

class QueryLoginLogDto extends PagerDto {
  @ApiPropertyOptional({ description: '用户名模糊过滤', example: 'admin' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  username?: string

  @ApiPropertyOptional({ description: '结果过滤（jeecg 语义）：0 成功 / 1 失败', example: 0, enum: [0, 1] })
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
  @MaxLength(100)
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
  @ApiProperty({ description: '要删除的日志 ID 列表（32 位字符串）', example: ['69b866e4ce4219330ed2093d6fe67e2a'] })
  @IsArray()
  @ArrayNotEmpty({ message: 'ids 不能为空' })
  @IsString({ each: true })
  ids: string[]
}

/**
 * 日志管理接口 V1：/api/v1/logs/**
 *
 * 单表 sys_log（对齐 JeecgBoot）：log_type=0 登录日志、log_type=1 操作日志；
 * status 为 jeecg 语义 0 成功 / 1 失败。
 */
@ApiTags('日志管理 V1')
@ApiBearerAuth('jwt')
@Controller('v1/logs')
export class LogV1Controller {
  constructor(private readonly logService: LogService) {}

  @ApiOperation({ summary: '登录日志分页列表（v1）', description: '支持用户名/结果/时间范围过滤；status 0 成功 1 失败' })
  @ApiOkResponse({ description: '登录日志分页', type: SysLogEntity })
  @Perms('system:log:login')
  @Get('login')
  listLoginLog(@Query() query: QueryLoginLogDto) {
    return this.logService.listLoginLog(query)
  }

  @ApiOperation({ summary: '导出登录日志 Excel（v1）', description: '与列表同过滤条件，不分页；需 system:log:export 权限' })
  @Perms('system:log:export')
  @Get('login/export')
  async exportLoginLog(@Query() query: QueryLoginLogDto, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const rows = await this.logService.exportLoginLog(query)
    const buffer = await buildXlsx(
      '登录日志',
      [
        { header: 'ID', width: 34 },
        { header: '用户名', width: 16 },
        { header: '结果', width: 10 },
        { header: '说明', width: 36 },
        { header: 'IP', width: 18 },
        { header: '归属地', width: 18 },
        { header: '浏览器', width: 16 },
        { header: '操作系统', width: 16 },
        { header: '登录时间', width: 22 }
      ],
      rows.map(row => [
        row.id,
        row.operateUserName,
        row.status === 0 ? '成功' : '失败',
        row.logContent,
        row.ip,
        row.location ?? '未知',
        row.browser ?? '未知',
        row.os ?? '未知',
        formatDateTime(row.createTime)
      ])
    )
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="login-logs-${Date.now()}.xlsx"`)
    return new StreamableFile(buffer)
  }

  @ApiOperation({ summary: '登录日志详情（v1）' })
  @Perms('system:log:login')
  @Get('login/:id')
  findLoginLog(@Param('id') id: string) {
    return this.logService.findLoginLog(id)
  }

  @ApiOperation({ summary: '操作日志分页列表（v1）', description: '支持操作人/模块/时间范围过滤；status 0 成功 1 失败' })
  @ApiOkResponse({ description: '操作日志分页', type: SysLogEntity })
  @Perms('system:log:oper')
  @Get('oper')
  listOperLog(@Query() query: QueryOperLogDto) {
    return this.logService.listOperLog(query)
  }

  @ApiOperation({ summary: '导出操作日志 Excel（v1）', description: '与列表同过滤条件，不分页；需 system:log:export 权限' })
  @Perms('system:log:export')
  @Get('oper/export')
  async exportOperLog(@Query() query: QueryOperLogDto, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const rows = await this.logService.exportOperLog(query)
    const buffer = await buildXlsx(
      '操作日志',
      [
        { header: 'ID', width: 34 },
        { header: '操作人', width: 16 },
        { header: '内容', width: 40 },
        { header: 'IP', width: 18 },
        { header: '结果', width: 10 },
        { header: '错误信息', width: 30 },
        { header: '耗时(ms)', width: 12 },
        { header: '请求参数', width: 44 },
        { header: '操作时间', width: 22 }
      ],
      rows.map(row => [
        row.id,
        row.operateUserName,
        row.logContent,
        row.ip,
        row.status === 0 ? '成功' : '失败',
        row.errorMsg,
        row.costTime,
        row.params,
        formatDateTime(row.createTime)
      ])
    )
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="oper-logs-${Date.now()}.xlsx"`)
    return new StreamableFile(buffer)
  }

  @ApiOperation({ summary: '操作日志详情（v1）' })
  @Perms('system:log:oper')
  @Get('oper/:id')
  findOperLog(@Param('id') id: string) {
    return this.logService.findOperLog(id)
  }

  @ApiOperation({ summary: '批量删除登录日志（v1）' })
  @OperLog('日志管理')
  @Perms('system:log:delete')
  @Delete('login')
  removeLoginLogs(@Body() dto: DeleteLogsDto) {
    return this.logService.removeLoginLogs(dto.ids)
  }

  @ApiOperation({ summary: '批量删除操作日志（v1）' })
  @OperLog('日志管理')
  @Perms('system:log:delete')
  @Delete('oper')
  removeOperLogs(@Body() dto: DeleteLogsDto) {
    return this.logService.removeOperLogs(dto.ids)
  }
}
