import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Request,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'

import { BatchDeleteDto } from '../../../common/dto/batch-delete.dto'
import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
import { IMPORT_MAX_SIZE } from '../../../helper/import/excel-import'
import { formatDateTime } from '../../../utils/csv.util'
import { setDownloadHeaders } from '../../../utils/download.util'
import { buildImportTemplateXlsx, buildXlsx, readXlsxTable } from '../../../utils/xlsx.util'
import { CreateLevelDto } from './dto/create-level.dto'
import { QueryLevelDto } from './dto/query-level.dto'
import { UpdateLevelDto } from './dto/update-level.dto'
import { LevelEntity } from './entities/level.entity'
import { LevelService } from './level.service'

/** 状态着色：正常绿、停用灰，导出后一眼能看出失效职级 */
const STATUS_STYLE = { 1: { fontColor: 'FF0F766E', fillColor: 'FFE7F7F0' }, 0: { fontColor: 'FF6B7280', fillColor: 'FFF3F4F6' } }

/**
 * 职级管理接口 V1：/api/v1/levels/**
 *
 * 版本策略：URL 前缀做版本，新模块直接只挂 v1 路由。
 */
@ApiTags('职级管理 V1')
@ApiBearerAuth('jwt')
@Controller('v1/levels')
export class LevelV1Controller {
  constructor(private readonly levelService: LevelService) {}

  @ApiOperation({ summary: '职级列表（v1）', description: 'level_rank 降序（级别从高到低）；keyword 模糊匹配名称/备注；需 system:level:list' })
  @ApiOkResponse({ description: '职级列表', type: [LevelEntity] })
  @Perms('system:level:list')
  @Get()
  list(@Query() query: QueryLevelDto): Promise<LevelEntity[]> {
    return this.levelService.listByQuery(query)
  }

  @ApiOperation({
    summary: '导出职级 Excel（v1）',
    description: '与列表同筛选条件（keyword），单次最多 5000 行；带大标题、冻结表头与斑马纹；需 system:level:export'
  })
  @Perms('system:level:export')
  @Get('export')
  async export(
    @Query() query: QueryLevelDto,
    @Request() req: { user: { username: string } },
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const levels = await this.levelService.exportLevels(query)
    const buffer = await buildXlsx(
      '职级列表',
      [
        { header: '职级名称', width: 18 },
        { header: '等级数值', width: 12, align: 'center' },
        { header: '状态', width: 10, align: 'center' },
        { header: '备注', width: 40 },
        { header: '创建时间', width: 20, align: 'center' }
      ],
      levels.map(level => [level.levelName, level.levelRank, level.status === '0' ? '停用' : '正常', level.remark ?? '', formatDateTime(level.createTime)]),
      {
        title: '职级列表',
        subtitle: `导出时间：${formatDateTime(new Date())} · 操作人：${req.user?.username ?? '未知'} · 共 ${levels.length} 条记录${query.keyword ? ` · 筛选：关键字=${query.keyword}` : ''}`,
        notes: ['说明：等级数值越大级别越高；「停用」的职级不再用于新增用户，但已绑定的用户不受影响。'],
        cellStyle: (rowIndex, columnIndex, value) => {
          if (columnIndex === 2 && typeof value === 'string') {
            return value === '停用' ? STATUS_STYLE[0] : STATUS_STYLE[1]
          }
          return undefined
        }
      }
    )
    setDownloadHeaders(res, `levels-${Date.now()}.xlsx`, `职级列表-${formatDateTime(new Date()).slice(0, 10)}.xlsx`)
    return new StreamableFile(buffer)
  }

  @ApiOperation({
    summary: '下载职级导入模板 Excel（v1）',
    description: '首个工作表为填写说明 + 表头（必填列带 * 与批注），第二个工作表为填写示例；需 system:level:import'
  })
  @Perms('system:level:import')
  @Get('import-template')
  async downloadTemplate(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const buffer = await buildImportTemplateXlsx({
      sheetName: '职级导入',
      title: '职级导入模板',
      notes: [
        '填写说明（请从「职级导入」这张表的表头下方开始填写，不要改动表头；示例见第二张表）：',
        '1. 带 * 的列为必填；「职级名称」已存在时更新该职级，不存在则新增。',
        '2. 等级数值填 0 或正整数，数字越大级别越高；留空按 0 处理。',
        '3. 状态填「正常」/「停用」，留空按「正常」处理；备注可留空。'
      ],
      columns: [
        { header: '职级名称', width: 20, required: true, hint: '如 P6 / M1，同名视为更新' },
        { header: '等级数值', width: 12, hint: '0 或正整数，越大级别越高' },
        { header: '状态', width: 10, hint: '正常 / 停用' },
        { header: '备注', width: 40 }
      ],
      samples: [
        ['P6', '6', '正常', '高级工程师'],
        ['M1', '10', '正常', '基层管理']
      ]
    })
    setDownloadHeaders(res, 'levels-import-template.xlsx', '职级导入模板.xlsx')
    return new StreamableFile(buffer)
  }

  @ApiOperation({
    summary: '导入职级 Excel（v1）',
    description: 'multipart/form-data，字段名 file；按「职级名称」判定新增或更新；单行失败不影响其他行；需 system:level:import'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary', description: 'Excel 文件（.xlsx，≤5MB，≤2000 行）' } },
      required: ['file']
    }
  })
  @OperLog('职级管理')
  @Perms('system:level:import')
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_SIZE } }))
  async import(@UploadedFile() file: Express.Multer.File | undefined, @Request() req: { user: { username: string } }) {
    if (!file) {
      throw new BadRequestException('未接收到文件，请选择 Excel 后重试')
    }
    if (!/\.xlsx$/i.test(file.originalname ?? '')) {
      throw new BadRequestException('仅支持 .xlsx 文件，请下载模板填写后导入')
    }
    const table = await readXlsxTable(file.buffer, { headerKeys: ['职级名称', '名称', '职级', 'levelname'] })
    return this.levelService.importLevels(table.rows, table.headerRow, req.user?.username)
  }

  @ApiOperation({ summary: '批量删除职级（v1）', description: '单次最多 200 条，逐条结算并返回失败原因；需 system:level:delete' })
  @OperLog('职级管理')
  @Perms('system:level:delete')
  @Post('batch-delete')
  batchDelete(@Body() dto: BatchDeleteDto) {
    return this.levelService.batchDelete(dto.ids)
  }

  @ApiOperation({ summary: '职级详情（v1）', description: '需 system:level:list' })
  @ApiOkResponse({ description: '职级信息', type: LevelEntity })
  @Perms('system:level:list')
  @Get(':id')
  findOne(@Param('id') id: string): Promise<LevelEntity> {
    return this.levelService.findOne(id)
  }

  @ApiOperation({ summary: '创建职级（v1）', description: 'levelName 唯一' })
  @OperLog('职级管理')
  @Perms('system:level:add')
  @Post()
  create(@Body() dto: CreateLevelDto, @Request() req: { user: { username: string } }): Promise<LevelEntity> {
    return this.levelService.createLevel(dto, req.user.username)
  }

  @ApiOperation({ summary: '更新职级（v1）', description: '改名时校验唯一' })
  @OperLog('职级管理')
  @Perms('system:level:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLevelDto, @Request() req: { user: { username: string } }): Promise<LevelEntity> {
    return this.levelService.updateLevel(id, dto, req.user.username)
  }

  @ApiOperation({ summary: '删除职级（v1）', description: '硬删除，职级暂无关联数据' })
  @OperLog('职级管理')
  @Perms('system:level:delete')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.levelService.delete(id)
  }
}
