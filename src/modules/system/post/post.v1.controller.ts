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
import { CreatePostDto } from './dto/create-post.dto'
import { QueryPostDto } from './dto/query-post.dto'
import { UpdatePostDto } from './dto/update-post.dto'
import { PostEntity } from './entities/post.entity'
import { PostService } from './post.service'

/** 状态着色：正常绿、停用灰 */
const STATUS_STYLE = { 1: { fontColor: 'FF0F766E', fillColor: 'FFE7F7F0' }, 0: { fontColor: 'FF6B7280', fillColor: 'FFF3F4F6' } }

/**
 * 岗位管理接口 V1：/api/v1/posts/**
 *
 * 版本策略：URL 前缀做版本，新模块直接只挂 v1 路由。
 */
@ApiTags('岗位管理 V1')
@ApiBearerAuth('jwt')
@Controller('v1/posts')
export class PostV1Controller {
  constructor(private readonly postService: PostService) {}

  @ApiOperation({ summary: '岗位列表（v1）', description: 'post_sort 升序，带所属部门；keyword 模糊匹配名称/编码/描述；支持 deptId 过滤；需 system:post:list' })
  @ApiOkResponse({ description: '岗位列表', type: [PostEntity] })
  @Perms('system:post:list')
  @Get()
  list(@Query() query: QueryPostDto): Promise<PostEntity[]> {
    return this.postService.listByQuery(query)
  }

  @ApiOperation({ summary: '导出岗位 Excel（v1）', description: '与列表同筛选条件（keyword/deptId），单次最多 5000 行；需 system:post:export' })
  @Perms('system:post:export')
  @Get('export')
  async export(
    @Query() query: QueryPostDto,
    @Request() req: { user: { username: string } },
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const posts = await this.postService.exportPosts(query)
    const buffer = await buildXlsx(
      '岗位列表',
      [
        { header: '岗位编码', width: 22 },
        { header: '岗位名称', width: 20 },
        { header: '所属部门', width: 24 },
        { header: '排序', width: 8, align: 'center' },
        { header: '状态', width: 10, align: 'center' },
        { header: '描述', width: 40 },
        { header: '创建时间', width: 20, align: 'center' }
      ],
      posts.map(post => [
        post.postCode,
        post.postName,
        post.dept?.departName ?? '',
        post.postSort ?? 0,
        post.status === '0' ? '停用' : '正常',
        post.description ?? '',
        formatDateTime(post.createTime)
      ]),
      {
        title: '岗位列表',
        subtitle: `导出时间：${formatDateTime(new Date())} · 操作人：${req.user?.username ?? '未知'} · 共 ${posts.length} 条记录${query.keyword ? ` · 筛选：关键字=${query.keyword}` : ''}`,
        notes: ['说明：岗位编码全局唯一，导入时按编码判定新增或更新；所属部门为空表示该岗位未挂部门。'],
        cellStyle: (rowIndex, columnIndex, value) => {
          if (columnIndex === 4 && typeof value === 'string') {
            return value === '停用' ? STATUS_STYLE[0] : STATUS_STYLE[1]
          }
          return undefined
        }
      }
    )
    setDownloadHeaders(res, `posts-${Date.now()}.xlsx`, `岗位列表-${formatDateTime(new Date()).slice(0, 10)}.xlsx`)
    return new StreamableFile(buffer)
  }

  @ApiOperation({ summary: '下载岗位导入模板 Excel（v1）', description: '含填写说明、表头与示例工作表；需 system:post:import' })
  @Perms('system:post:import')
  @Get('import-template')
  async downloadTemplate(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const buffer = await buildImportTemplateXlsx({
      sheetName: '岗位导入',
      title: '岗位导入模板',
      notes: [
        '填写说明（请从「岗位导入」这张表的表头下方开始填写，不要改动表头；示例见第二张表）：',
        '1. 带 * 的列为必填；「岗位编码」已存在时更新该岗位，不存在则新增。',
        '2. 所属部门填部门名称，须与部门管理中的名称完全一致；留空表示不挂部门。',
        '3. 排序填 0 或正整数（越小越靠前）；状态填「正常」/「停用」，留空按「正常」处理。'
      ],
      columns: [
        { header: '岗位编码', width: 22, required: true, hint: '唯一，如 dev_engineer；已存在则更新' },
        { header: '岗位名称', width: 20, required: true },
        { header: '所属部门', width: 24, hint: '部门名称，需与部门管理一致' },
        { header: '排序', width: 8, hint: '0 或正整数，越小越靠前' },
        { header: '状态', width: 10, hint: '正常 / 停用' },
        { header: '描述', width: 40 }
      ],
      samples: [
        ['dev_engineer', '研发工程师', '技术部', '1', '正常', '负责后端服务开发'],
        ['hr_specialist', '人事专员', '人力资源部', '2', '正常', '']
      ]
    })
    setDownloadHeaders(res, 'posts-import-template.xlsx', '岗位导入模板.xlsx')
    return new StreamableFile(buffer)
  }

  @ApiOperation({
    summary: '导入岗位 Excel（v1）',
    description: 'multipart/form-data，字段名 file；按「岗位编码」判定新增或更新；单行失败不影响其他行；需 system:post:import'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary', description: 'Excel 文件（.xlsx，≤5MB，≤2000 行）' } },
      required: ['file']
    }
  })
  @OperLog('岗位管理')
  @Perms('system:post:import')
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_SIZE } }))
  async import(@UploadedFile() file: Express.Multer.File | undefined, @Request() req: { user: { username: string } }) {
    if (!file) {
      throw new BadRequestException('未接收到文件，请选择 Excel 后重试')
    }
    if (!/\.xlsx$/i.test(file.originalname ?? '')) {
      throw new BadRequestException('仅支持 .xlsx 文件，请下载模板填写后导入')
    }
    const table = await readXlsxTable(file.buffer, { headerKeys: ['岗位编码', '编码', 'postcode'] })
    return this.postService.importPosts(table.rows, table.headerRow, req.user?.username)
  }

  @ApiOperation({ summary: '批量删除岗位（v1）', description: '单次最多 200 条，逐条结算并返回失败原因；需 system:post:delete' })
  @OperLog('岗位管理')
  @Perms('system:post:delete')
  @Post('batch-delete')
  batchDelete(@Body() dto: BatchDeleteDto) {
    return this.postService.batchDelete(dto.ids)
  }

  @ApiOperation({ summary: '岗位详情（v1）', description: '需 system:post:list' })
  @ApiOkResponse({ description: '岗位信息', type: PostEntity })
  @Perms('system:post:list')
  @Get(':id')
  findOne(@Param('id') id: string): Promise<PostEntity> {
    return this.postService.findOne(id)
  }

  @ApiOperation({ summary: '创建岗位（v1）', description: 'postCode 唯一；deptId 传入时必须存在且未删除' })
  @OperLog('岗位管理')
  @Perms('system:post:add')
  @Post()
  create(@Body() dto: CreatePostDto, @Request() req: { user: { username: string } }): Promise<PostEntity> {
    return this.postService.createPost(dto, req.user.username)
  }

  @ApiOperation({ summary: '更新岗位（v1）', description: '改编码校验唯一、换部门校验存在' })
  @OperLog('岗位管理')
  @Perms('system:post:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePostDto, @Request() req: { user: { username: string } }): Promise<PostEntity> {
    return this.postService.updatePost(id, dto, req.user.username)
  }

  @ApiOperation({ summary: '删除岗位（v1）', description: '硬删除，岗位暂无关联数据' })
  @OperLog('岗位管理')
  @Perms('system:post:delete')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.postService.delete(id)
  }
}
