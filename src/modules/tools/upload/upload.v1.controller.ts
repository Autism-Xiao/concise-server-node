import { Controller, Post, Request, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Perms } from '../../../common/decorators/perms.decorator'
import { RateLimit } from '../../../common/decorators/rate-limit.decorator'
import { UPLOAD_FILE_SIZE, UPLOAD_MIMETYPES, imageFileFilter } from './upload.controller'
import { FileUploadDto } from './upload.dto'
import { UploadService } from './upload.service'

/**
 * V1 图片上传（头像、富文本插图等场景共用的位图上传服务）
 *
 * 与旧版 `/api/upload` 完全同能力，差别只有两点：
 * - 挂 `/v1` 前缀，纳入接口契约二期「新接口只挂 /api/v1/**」的约定；
 * - 权限码对齐文件管理体系的 `system:file:upload`（旧版用 tools:upload，
 *   导致角色权限树里「文件上传」出现两次）。
 */
@ApiTags('工具 - 上传模块')
@ApiBearerAuth('jwt')
@Controller('v1/upload')
export class UploadV1Controller {
  constructor(private readonly uploadService: UploadService) {}

  @ApiOperation({
    summary: '上传图片（v1）',
    description: `multipart/form-data，字段名 file；仅 ${UPLOAD_MIMETYPES.join(' / ')}，按文件头校验真实类型，上限 10MB`
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: FileUploadDto })
  @ApiOkResponse({ description: '返回文件相对路径 path，静态访问地址为 {host}{path}' })
  @Perms('system:file:upload')
  @RateLimit({ limit: 30, window: 60, message: '上传过于频繁，请稍后再试' })
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: UPLOAD_FILE_SIZE, files: 1 },
      fileFilter: imageFileFilter
    })
  )
  upload(@UploadedFile() file: Express.Multer.File, @Request() req: { user?: { id: string } }) {
    return this.uploadService.saveFile(file, req.user?.id)
  }
}
