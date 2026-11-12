import { Body, Controller, Delete, Get, Param, Post, Query, Request, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { Type } from 'class-transformer'
import { ArrayNotEmpty, IsArray, IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

import { Perms } from '../../../common/decorators/perms.decorator'
import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { PagerDto } from '../../../common/dto/pager.dto'
import { sendXlsx } from '../../../helper/export/excel-export'
import { IMPORT_MAX_SIZE } from '../../../helper/import/excel-import'
import { readImportFile } from '../../../helper/import/import-file'
import { formatDateTime } from '../../../utils/csv.util'
import { setDownloadHeaders } from '../../../utils/download.util'
import { buildImportTemplateXlsx } from '../../../utils/xlsx.util'
import { LogService } from './log.service'
import { SysLogEntity } from './entities/sys-log.entity'

/** 结果着色：成功绿、失败红，与用户管理导出的状态列一致 */
const STATUS_STYLE = { 0: { fontColor: 'FF0F766E', fillColor: 'FFE7F7F0' }, 1: { fontColor: 'FFB42318', fillColor: 'FFFDECEC' } }

class QueryLoginLogDto extends PagerDto {
  @ApiPropertyOptional({ description: '用户 ID 精确过滤（sys_user.id，用户管理页登录日志弹窗用）', example: 'e9ca23d68d884d4ebb19d07889727dae' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  userId?: string

  @ApiPropertyOptional({ description: '用户名模糊过滤', example: 'admin' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  username?: string

  @ApiPropertyOptional({ description: '结果过滤：0 成功 / 1 失败', example: 0, enum: [0, 1] })
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
 * 单表 sys_log：log_type=0 登录日志、log_type=1 操作日志；
 * status 取值 0 成功 / 1 失败。
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

  @ApiOperation({
    summary: '导出登录日志 Excel（v1）',
    description: '与列表同过滤条件，不分页；副标题含导出时间/操作人/条数/筛选条件；需 system:log:export 权限'
  })
  @Perms('system:log:export')
  @Get('login/export')
  async exportLoginLog(
    @Query() query: QueryLoginLogDto,
    @Request() req: { user: { username: string } },
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const rows = await this.logService.exportLoginLog(query)
    const filters = [
      query.username ? `用户名=${query.username}` : '',
      query.status !== undefined ? `结果=${query.status === 0 ? '成功' : '失败'}` : '',
      query.startTime ? `起始=${formatDateTime(query.startTime)}` : '',
      query.endTime ? `结束=${formatDateTime(query.endTime)}` : ''
    ]

    return sendXlsx({
      res,
      sheetName: '登录日志',
      columns: [
        { header: 'ID', width: 34 },
        { header: '用户名', width: 16 },
        { header: '结果', width: 10, align: 'center' },
        { header: '说明', width: 36 },
        { header: 'IP', width: 18 },
        { header: '归属地', width: 18 },
        { header: '浏览器', width: 16 },
        { header: '操作系统', width: 16 },
        { header: '登录时间', width: 22, align: 'center' }
      ],
      rows: rows.map(row => [
        row.id,
        row.operateUserName,
        row.status === 0 ? '成功' : '失败',
        row.logContent,
        row.ip,
        row.location ?? '未知',
        row.browser ?? '未知',
        row.os ?? '未知',
        formatDateTime(row.createTime)
      ]),
      notes: ['说明：结果列为「成功/失败」，失败原因见说明列；归属地由 IP 库解析，内网地址显示为内网。'],
      cellStyle: (rowIndex, columnIndex, value) => {
        if (columnIndex !== 2 || typeof value !== 'string') {
          return undefined
        }
        return value === '成功' ? STATUS_STYLE[0] : STATUS_STYLE[1]
      },
      meta: { operator: req.user?.username, count: rows.length, filters },
      filePrefix: 'login-logs',
      displayName: '登录日志'
    })
  }

  @ApiOperation({
    summary: '下载登录日志导入模板（v1）',
    description: '首个工作表为填写说明 + 表头（必填列带 * 与批注），第二个工作表为填写示例；需 system:log:import'
  })
  @Perms('system:log:import')
  @Get('login/import-template')
  async downloadLoginTemplate(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const buffer = await buildImportTemplateXlsx({
      sheetName: '登录日志导入',
      title: '登录日志导入模板',
      notes: [
        '填写说明（请从「登录日志导入」这张表的表头下方开始填写，不要改动表头；示例见第二张表）：',
        '1. 带 * 的列为必填；本导入只做新增，不会覆盖已有日志。',
        '2. 「结果」填 成功/失败（也接受 正常/异常、0/1），留空按成功记录。',
        '3. 「登录时间」用 2026-11-06 19:00:00 格式，留空取导入时刻；「IP」留空记为 0.0.0.0。',
        '4. 单次最多 2000 行，单行失败不影响其他行，导入结束后会返回逐行失败原因。'
      ],
      columns: [
        { header: '用户名', width: 16, required: true, hint: '登录账号' },
        { header: '结果', width: 10, hint: '成功 / 失败' },
        { header: '说明', width: 36, hint: '失败原因等描述' },
        { header: 'IP', width: 18, hint: '留空记为 0.0.0.0' },
        { header: '浏览器', width: 16 },
        { header: '操作系统', width: 16 },
        { header: '登录时间', width: 22, hint: '2026-11-06 19:00:00' }
      ],
      samples: [['zhangsan', '成功', '登录成功', '192.168.1.20', 'Chrome 156', 'Windows 10', '2026-11-06 09:12:33']]
    })
    setDownloadHeaders(res, 'login-logs-import-template.xlsx', '登录日志导入模板.xlsx')
    return new StreamableFile(buffer)
  }

  @ApiOperation({
    summary: '导入登录日志 Excel（v1）',
    description: 'multipart/form-data，字段名 file；支持 .xlsx（推荐）与 .csv；按「用户名」为必填列，只新增不覆盖；单行失败不影响其他行'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary', description: 'Excel 文件（.xlsx，≤5MB，≤2000 行）；兼容 .csv（UTF-8）' } },
      required: ['file']
    }
  })
  @OperLog('日志管理')
  @Perms('system:log:import')
  @Post('login/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_SIZE } }))
  async importLoginLog(@UploadedFile() file: Express.Multer.File | undefined, @Request() req: { user: { username: string } }) {
    const table = await readImportFile(file, { headerKeys: ['用户名', '登录账号', 'operateusername'] })
    return this.logService.importLoginLogs(table.rows, table.headerRow, req.user?.username)
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

  @ApiOperation({
    summary: '导出操作日志 Excel（v1）',
    description: '与列表同过滤条件，不分页；副标题含导出时间/操作人/条数/筛选条件；需 system:log:export 权限'
  })
  @Perms('system:log:export')
  @Get('oper/export')
  async exportOperLog(
    @Query() query: QueryOperLogDto,
    @Request() req: { user: { username: string } },
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const rows = await this.logService.exportOperLog(query)
    const filters = [
      query.username ? `操作人=${query.username}` : '',
      query.module ? `模块=${query.module}` : '',
      query.startTime ? `起始=${formatDateTime(query.startTime)}` : '',
      query.endTime ? `结束=${formatDateTime(query.endTime)}` : ''
    ]

    return sendXlsx({
      res,
      sheetName: '操作日志',
      columns: [
        { header: 'ID', width: 34 },
        { header: '操作人', width: 16 },
        { header: '内容', width: 40 },
        { header: 'IP', width: 18 },
        { header: '结果', width: 10, align: 'center' },
        { header: '错误信息', width: 30 },
        { header: '耗时(ms)', width: 12, align: 'right' },
        { header: '请求参数', width: 44 },
        { header: '操作时间', width: 22, align: 'center' }
      ],
      rows: rows.map(row => [
        row.id,
        row.operateUserName,
        row.logContent,
        row.ip,
        row.status === 0 ? '成功' : '失败',
        row.errorMsg,
        row.costTime,
        row.params,
        formatDateTime(row.createTime)
      ]),
      notes: ['说明：耗时单位为毫秒；请求参数中的密码类字段已脱敏；失败原因见错误信息列。'],
      cellStyle: (rowIndex, columnIndex, value) => {
        if (columnIndex !== 4 || typeof value !== 'string') {
          return undefined
        }
        return value === '成功' ? STATUS_STYLE[0] : STATUS_STYLE[1]
      },
      meta: { operator: req.user?.username, count: rows.length, filters },
      filePrefix: 'oper-logs',
      displayName: '操作日志'
    })
  }

  @ApiOperation({
    summary: '下载操作日志导入模板（v1）',
    description: '首个工作表为填写说明 + 表头（必填列带 * 与批注），第二个工作表为填写示例；需 system:log:import'
  })
  @Perms('system:log:import')
  @Get('oper/import-template')
  async downloadOperTemplate(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const buffer = await buildImportTemplateXlsx({
      sheetName: '操作日志导入',
      title: '操作日志导入模板',
      notes: [
        '填写说明（请从「操作日志导入」这张表的表头下方开始填写，不要改动表头；示例见第二张表）：',
        '1. 带 * 的列为必填；本导入只做新增，不会覆盖已有日志。',
        '2. 「模块」「操作」会拼成日志内容「模块 - 操作」，供列表与筛选使用。',
        '3. 「结果」填 成功/失败（也接受 正常/异常、0/1），留空按成功记录；「耗时」填毫秒整数。',
        '4. 「操作时间」用 2026-11-06 19:00:00 格式，留空取导入时刻；单次最多 2000 行。'
      ],
      columns: [
        { header: '操作人', width: 16, required: true, hint: '登录账号' },
        { header: '模块', width: 16, required: true, hint: '如 用户管理' },
        { header: '操作', width: 20, required: true, hint: '如 新增用户' },
        { header: '结果', width: 10, hint: '成功 / 失败' },
        { header: '耗时', width: 12, hint: '毫秒，正整数' },
        { header: 'IP', width: 18, hint: '留空记为 0.0.0.0' },
        { header: '操作时间', width: 22, hint: '2026-11-06 19:00:00' }
      ],
      samples: [['zhangsan', '用户管理', '新增用户', '成功', '86', '192.168.1.20', '2026-11-06 09:12:33']]
    })
    setDownloadHeaders(res, 'oper-logs-import-template.xlsx', '操作日志导入模板.xlsx')
    return new StreamableFile(buffer)
  }

  @ApiOperation({
    summary: '导入操作日志 Excel（v1）',
    description: 'multipart/form-data，字段名 file；支持 .xlsx（推荐）与 .csv；必填列 操作人/模块/操作，只新增不覆盖；单行失败不影响其他行'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary', description: 'Excel 文件（.xlsx，≤5MB，≤2000 行）；兼容 .csv（UTF-8）' } },
      required: ['file']
    }
  })
  @OperLog('日志管理')
  @Perms('system:log:import')
  @Post('oper/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_SIZE } }))
  async importOperLog(@UploadedFile() file: Express.Multer.File | undefined, @Request() req: { user: { username: string } }) {
    const table = await readImportFile(file, { headerKeys: ['操作人', '用户名', 'operateusername'] })
    return this.logService.importOperLogs(table.rows, table.headerRow, req.user?.username)
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
