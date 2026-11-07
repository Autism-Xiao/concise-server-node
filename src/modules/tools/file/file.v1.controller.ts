import fs from 'node:fs'
import path from 'node:path'
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Request,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { diskStorage } from 'multer'
import type { Response } from 'express'

import { BatchDeleteDto } from '../../../common/dto/batch-delete.dto'
import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
import { RateLimit } from '../../../common/decorators/rate-limit.decorator'
import { Pagination } from '../../../helper/paginate'
import { CreateFolderDto } from './dto/create-folder.dto'
import { QueryFileDto } from './dto/query-file.dto'
import { UpdateFileDto } from './dto/update-file.dto'
import { UploadFileDto } from './dto/upload-file.dto'
import { FileEntity } from './entities/file.entity'
import { FileService } from './file.service'

/** 单文件上限（MB），默认 200；大文件走 diskStorage，不占 Node 内存 */
function uploadMaxBytes(): number {
  return Number(process.env.FILE_UPLOAD_MAX_MB ?? 200) * 1024 * 1024
}

/** multer 临时目录：和存储目录同盘，后续 rename 才是毫秒级 */
function uploadTempDir(): string {
  return process.env.FILE_TEMP_DIR?.trim() || path.join(process.cwd(), 'storage/tmp')
}

interface AuthedRequest {
  user?: { id?: string; userId?: string }
}

/**
 * 文件管理接口 V1：/api/v1/files/**
 *
 * 定位是「个人空间」：所有查询都按当前登录用户 owner_id 过滤，
 * 换 id 也拿不到别人的文件（防 IDOR）；管理员不越权查看，避免变成合规漏洞。
 *
 * 目录与文件同表（is_folder 区分），逻辑目录只存库，
 * 物理文件按 sha256 内容寻址放在 storage/files 下 —— 这个目录**不挂静态托管**，
 * 一律走 /:id/download 下载，避免上传的 HTML 被同源执行成 XSS。
 */
@ApiTags('文件管理 V1')
@ApiBearerAuth('jwt')
@Controller('v1/files')
export class FileV1Controller {
  constructor(private readonly fileService: FileService) {}

  /** 从 JWT 里取用户 id（项目里 user.id 是主键字符串） */
  private ownerIdOf(req: AuthedRequest): string {
    return String(req.user?.id ?? req.user?.userId ?? '')
  }

  @ApiOperation({
    summary: '文件列表（v1）',
    description: '只列当前目录（parentId，0=根）；文件夹优先；keyword 模糊匹配名称；kind 分类过滤；需 system:file:list'
  })
  @ApiOkResponse({ description: '文件分页列表', type: Pagination })
  @Perms('system:file:list')
  @Get()
  list(@Query() query: QueryFileDto, @Request() req: AuthedRequest): Promise<Pagination<FileEntity>> {
    return this.fileService.list(this.ownerIdOf(req), query)
  }

  @ApiOperation({ summary: '面包屑（v1）', description: '从「全部文件」到当前目录的路径链，folderId=0 只返回根；需 system:file:list' })
  @Perms('system:file:list')
  @Get('breadcrumb')
  breadcrumb(@Query('folderId') folderId: string, @Request() req: AuthedRequest) {
    return this.fileService.breadcrumb(this.ownerIdOf(req), Number(folderId ?? 0) || 0)
  }

  @ApiOperation({ summary: '存储用量统计（v1）', description: '总量 / 文件数 / 文件夹数 / 按分类分布 + 配额；需 system:file:list' })
  @Perms('system:file:list')
  @Get('stats')
  stats(@Request() req: AuthedRequest) {
    return this.fileService.stats(this.ownerIdOf(req))
  }

  @ApiOperation({ summary: '最近文件（v1）', description: '按修改时间倒序，最多 50 条；需 system:file:list' })
  @Perms('system:file:list')
  @Get('recent')
  recent(@Query('limit') limit: string, @Request() req: AuthedRequest) {
    return this.fileService.recent(this.ownerIdOf(req), Number(limit ?? 6) || 6)
  }

  @ApiOperation({ summary: '回收站列表（v1）', description: '已软删的文件，按删除时间倒序；需 system:file:list' })
  @Perms('system:file:list')
  @Get('recycled')
  recycled(@Query('page') page: string, @Query('pageSize') pageSize: string, @Request() req: AuthedRequest) {
    return this.fileService.recycled(this.ownerIdOf(req), Number(page ?? 1) || 1, Number(pageSize ?? 20) || 20)
  }

  @ApiOperation({ summary: '文件详情（v1）', description: '需 system:file:list' })
  @Perms('system:file:list')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: AuthedRequest) {
    return this.fileService.detail(this.ownerIdOf(req), id)
  }

  @ApiOperation({ summary: '新建文件夹（v1）', description: '同目录不允许重名；需 system:file:add' })
  @OperLog('文件管理')
  @Perms('system:file:add')
  @Post('folders')
  createFolder(@Body() dto: CreateFolderDto, @Request() req: AuthedRequest) {
    return this.fileService.createFolder(this.ownerIdOf(req), dto)
  }

  @ApiOperation({
    summary: '上传文件（v1）',
    description: 'multipart/form-data，字段名 file；可选 parentId 与 onConflict(rename/skip/overwrite)；单文件默认上限 200MB；需 system:file:upload'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: '要上传的文件' },
        parentId: { type: 'number', description: '目标目录 ID，0=根目录' },
        onConflict: { type: 'string', enum: ['rename', 'skip', 'overwrite'], description: '同名冲突策略，默认 rename' }
      }
    }
  })
  @OperLog('文件管理')
  @Perms('system:file:upload')
  @RateLimit({ limit: 60, window: 60, message: '上传过于频繁，请稍后再试' })
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, callback) => {
          const dir = uploadTempDir()
          fs.promises
            .mkdir(dir, { recursive: true })
            .then(() => callback(null, dir))
            .catch(error => callback(error as Error, dir))
        },
        filename: (_req, _file, callback) => {
          callback(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
        }
      }),
      limits: { fileSize: uploadMaxBytes(), files: 1 }
    })
  )
  upload(@UploadedFile() file: Express.Multer.File, @Body() dto: UploadFileDto, @Request() req: AuthedRequest) {
    return this.fileService.upload(this.ownerIdOf(req), file, dto)
  }

  @ApiOperation({ summary: '下载文件（v1）', description: '流式下载，响应头带 UTF-8 文件名；文件夹请进目录后选具体文件；需 system:file:download' })
  @Perms('system:file:download')
  @Get(':id/download')
  async download(@Param('id', ParseIntPipe) id: number, @Request() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const info = await this.fileService.getDownloadInfo(this.ownerIdOf(req), id)
    // ASCII 兜底名：中文全被剔除时用文件 id 代替，老浏览器也能存下来
    const fallback = info.name.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || `file-${id}`
    res.setHeader('Content-Type', info.mime)
    res.setHeader('Content-Length', String(info.size))
    res.setHeader('Content-Disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(info.name)}`)
    // 禁止浏览器嗅探内容类型：防止把上传的文本当 HTML 渲染
    res.setHeader('X-Content-Type-Options', 'nosniff')
    return new StreamableFile(fs.createReadStream(info.absolutePath))
  }

  @ApiOperation({ summary: '更新文件（v1）', description: '改名 / 移动 / 星标；移动会防环（不能移到自己或子孙目录）；需 system:file:update' })
  @OperLog('文件管理')
  @Perms('system:file:update')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFileDto, @Request() req: AuthedRequest) {
    return this.fileService.update(this.ownerIdOf(req), id, dto)
  }

  @ApiOperation({ summary: '删除文件（v1）', description: '软删除进回收站，文件夹连同子孙一起标记；物理文件保留；需 system:file:delete' })
  @OperLog('文件管理')
  @Perms('system:file:delete')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: AuthedRequest) {
    return this.fileService.softDelete(this.ownerIdOf(req), [id])
  }

  @ApiOperation({ summary: '批量删除（v1）', description: '批量软删进回收站；需 system:file:delete' })
  @OperLog('文件管理')
  @Perms('system:file:delete')
  @Post('batch-delete')
  batchDelete(@Body() dto: BatchDeleteDto, @Request() req: AuthedRequest) {
    return this.fileService.softDelete(
      this.ownerIdOf(req),
      dto.ids.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0)
    )
  }

  @ApiOperation({ summary: '从回收站恢复（v1）', description: '父目录也被删时一并恢复，避免恢复出孤儿节点；需 system:file:update' })
  @OperLog('文件管理')
  @Perms('system:file:update')
  @Post('restore')
  restore(@Body() dto: BatchDeleteDto, @Request() req: AuthedRequest) {
    return this.fileService.restore(
      this.ownerIdOf(req),
      dto.ids.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0)
    )
  }

  @ApiOperation({ summary: '彻底删除（v1）', description: '从回收站清除并删除物理文件（无其他引用时）；不可恢复；需 system:file:delete' })
  @OperLog('文件管理')
  @Perms('system:file:delete')
  @Post('purge')
  purge(@Body() dto: BatchDeleteDto, @Request() req: AuthedRequest) {
    return this.fileService.purge(
      this.ownerIdOf(req),
      dto.ids.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0)
    )
  }
}
