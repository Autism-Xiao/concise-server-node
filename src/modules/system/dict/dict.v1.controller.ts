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
import { Pagination, toPagination } from '../../../helper/paginate'
import { formatDateTime } from '../../../utils/csv.util'
import { setDownloadHeaders } from '../../../utils/download.util'
import { buildWorkbook, readXlsxTable } from '../../../utils/xlsx.util'
import { CreateDictDto } from './dto/create-dict.dto'
import { QueryDictDto } from './dto/query-dict.dto'
import { UpdateDictDto } from './dto/update-dict.dto'
import { DictService } from './dict.service'
import { SysDictEntity } from './entities/sys-dict.entity'

/** 字典类型表头（导出与导入模板共用列，保证「导出 → 改 → 再导入」能闭环） */
const TYPE_COLUMNS = [
  { header: '字典编码', width: 26 },
  { header: '字典名称', width: 22 },
  { header: '值类型', width: 12, align: 'left' as const },
  { header: '描述', width: 40 }
]

/** 字典项表头 */
const ITEM_COLUMNS = [
  { header: '字典编码', width: 26 },
  { header: '字典项文本', width: 20 },
  { header: '字典项值', width: 16 },
  { header: '排序', width: 8, align: 'center' as const },
  { header: '状态', width: 10, align: 'center' as const },
  { header: '描述', width: 36 }
]

/**
 * 数据字典接口 V1：/api/v1/dicts
 *
 * 表 sys_dict；删除是软删（del_flag=1），字典下还有字典项时拒绝删除。
 */
@ApiTags('数据字典 V1')
@ApiBearerAuth('jwt')
@Controller('v1/dicts')
export class DictV1Controller {
  constructor(private readonly dictService: DictService) {}

  @ApiOperation({ summary: '字典列表（v1）', description: '字典类型数量少，一次全量返回不分页；keyword 模糊匹配名称/编码；每项带 itemCount' })
  @ApiOkResponse({ description: '字典列表（统一分页结构；size = total，一次全量返回）', type: Pagination })
  @Perms('system:dict:list')
  @Get()
  async list(@Query() query: QueryDictDto): Promise<Pagination<SysDictEntity>> {
    return toPagination(await this.dictService.listByQuery(query))
  }

  @ApiOperation({
    summary: '导出字典 Excel（v1）',
    description: '一个工作簿两张表：字典类型 + 字典项（靠字典编码关联），与导入模板列一致，可改完再导回；需 system:dict:export'
  })
  @Perms('system:dict:export')
  @Get('export')
  async export(
    @Query() query: QueryDictDto,
    @Request() req: { user: { username: string } },
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const { dicts, items } = await this.dictService.exportDicts(query)
    const dictMap = new Map(dicts.map(dict => [dict.id, dict]))
    const buffer = await buildWorkbook([
      {
        sheetName: '字典类型',
        title: '字典类型',
        subtitle: `导出时间：${formatDateTime(new Date())} · 操作人：${req.user?.username ?? '未知'} · 共 ${dicts.length} 个字典${query.keyword ? ` · 筛选：关键字=${query.keyword}` : ''}`,
        columns: TYPE_COLUMNS,
        rows: dicts.map(dict => [dict.dictCode, dict.dictName, dict.type === 1 ? 'number' : 'string', dict.description ?? '']),
        notes: ['说明：字典编码全局唯一，导入时按编码判定新增或更新；值类型 string 表示字典项值是字符串，number 表示数字。']
      },
      {
        sheetName: '字典项',
        title: '字典项',
        subtitle: `共 ${items.length} 条记录 · 通过「字典编码」与上一张表关联`,
        columns: ITEM_COLUMNS,
        rows: items.map(item => [
          dictMap.get(item.dictId)?.dictCode ?? '',
          item.itemText,
          item.itemValue,
          item.sortOrder ?? 0,
          item.status === 0 ? '停用' : '启用',
          item.description ?? ''
        ]),
        notes: ['说明：同一字典下「字典项值」唯一；排序越小越靠前；停用的字典项不会出现在前端下拉框里。']
      }
    ])
    setDownloadHeaders(res, `dicts-${Date.now()}.xlsx`, `数据字典-${formatDateTime(new Date()).slice(0, 10)}.xlsx`)
    return new StreamableFile(buffer)
  }

  @ApiOperation({
    summary: '下载字典导入模板 Excel（v1）',
    description: '两张工作表：「字典类型」与「字典项」，靠字典编码关联；表头带 * 为必填；需 system:dict:import'
  })
  @Perms('system:dict:import')
  @Get('import-template')
  async downloadTemplate(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const buffer = await buildWorkbook([
      {
        sheetName: '字典类型',
        title: '字典导入模板 · 字典类型',
        subtitle: '填写说明：带 * 的列必填；字典编码已存在时更新该字典（含已删除的会恢复），不存在则新增。',
        columns: [
          { header: '字典编码 *', width: 26 },
          { header: '字典名称 *', width: 22 },
          { header: '值类型', width: 12 },
          { header: '描述', width: 40 }
        ],
        rows: [
          ['', '', '', ''],
          ['', '', '', ''],
          ['', '', '', '']
        ],
        notes: [
          '示例：字典编码 sys_user_gender｜字典名称 用户性别｜值类型 string｜描述 性别下拉框',
          '值类型填 string 或 number，留空按 string 处理。',
          '第二张表「字典项」通过字典编码与这张表关联，两张表可以一起填，也可以只填其中一张。'
        ]
      },
      {
        sheetName: '字典项',
        title: '字典导入模板 · 字典项',
        subtitle: '填写说明：字典编码必须能在上一张表中找到；同一字典下「字典项值」唯一。',
        columns: [
          { header: '字典编码 *', width: 26 },
          { header: '字典项文本 *', width: 20 },
          { header: '字典项值 *', width: 16 },
          { header: '排序', width: 8 },
          { header: '状态', width: 10 },
          { header: '描述', width: 36 }
        ],
        rows: [
          ['', '', '', '', '', ''],
          ['', '', '', '', '', ''],
          ['', '', '', '', '', '']
        ],
        notes: [
          '示例：字典编码 sys_user_gender｜字典项文本 男｜字典项值 1｜排序 1｜状态 启用',
          '状态填「启用」/「停用」，留空按启用处理；排序填 0 或正整数，越小越靠前。'
        ]
      }
    ])
    setDownloadHeaders(res, 'dicts-import-template.xlsx', '数据字典导入模板.xlsx')
    return new StreamableFile(buffer)
  }

  @ApiOperation({
    summary: '导入字典 Excel（v1）',
    description: 'multipart/form-data，字段名 file；读取「字典类型」与「字典项」两张工作表，可只填其中一张；单行失败不影响其他行；需 system:dict:import'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary', description: 'Excel 文件（.xlsx，≤5MB，单表 ≤2000 行）' } },
      required: ['file']
    }
  })
  @OperLog('数据字典')
  @Perms('system:dict:import')
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_SIZE } }))
  async import(@UploadedFile() file: Express.Multer.File | undefined, @Request() req: { user: { username: string } }) {
    if (!file) {
      throw new BadRequestException('未接收到文件，请选择 Excel 后重试')
    }
    if (!/\.xlsx$/i.test(file.originalname ?? '')) {
      throw new BadRequestException('仅支持 .xlsx 文件，请下载模板填写后导入')
    }
    const [typeTable, itemTable] = await Promise.all([
      readXlsxTable(file.buffer, { headerKeys: ['字典编码', '编码', 'dictcode'], sheetIndex: 0 }),
      readXlsxTable(file.buffer, { headerKeys: ['字典项文本', '项文本', 'itemtext'], sheetIndex: 1 })
    ])
    return this.dictService.importDicts(typeTable.rows, typeTable.headerRow, itemTable.rows, itemTable.headerRow, req.user?.username)
  }

  @ApiOperation({ summary: '批量删除字典（v1）', description: '单次最多 200 条；字典下存在字典项时该条失败并返回原因；需 system:dict:delete' })
  @OperLog('数据字典')
  @Perms('system:dict:delete')
  @Post('batch-delete')
  batchDelete(@Body() dto: BatchDeleteDto) {
    return this.dictService.batchDelete(dto.ids)
  }

  @ApiOperation({ summary: '字典详情（v1）' })
  @Perms('system:dict:list')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.dictService.findDetail(id)
  }

  @ApiOperation({ summary: '创建字典（v1）', description: 'dictCode 全局唯一（字母开头，可含数字/下划线/冒号/点/短横线）' })
  @OperLog('数据字典')
  @Perms('system:dict:add')
  @Post()
  create(@Body() dto: CreateDictDto, @Request() req: { user: { username: string } }) {
    return this.dictService.createDict(dto, req.user?.username)
  }

  @ApiOperation({ summary: '更新字典（v1）', description: '改 dictCode 时重新校验唯一性' })
  @OperLog('数据字典')
  @Perms('system:dict:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDictDto, @Request() req: { user: { username: string } }) {
    return this.dictService.updateDict(id, dto, req.user?.username)
  }

  @ApiOperation({ summary: '删除字典（v1）', description: '软删（del_flag=1）；字典下存在字典项时拒绝' })
  @OperLog('数据字典')
  @Perms('system:dict:delete')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.dictService.deleteDict(id)
    return { deleted: 1 }
  }
}
