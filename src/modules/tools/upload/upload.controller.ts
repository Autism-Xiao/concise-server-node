import { Controller, Post, Request, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiExcludeController, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Perms } from '../../../common/decorators/perms.decorator'
import { FileUploadDto } from './upload.dto'
import { UploadService } from './upload.service'

/** 与参考项目一致：仅图片，上限 10MB */
export const UPLOAD_FILE_SIZE = 10 * 1024 * 1024
export const UPLOAD_MIMETYPES = ['image/png', 'image/gif', 'image/jpeg', 'image/webp', 'image/svg+xml']

// 旧版无前缀接口：仅为向后兼容保留，不出现在 Swagger 文档中（文档只暴露 V1 + 系统分组）
@ApiExcludeController()
@ApiTags('工具 - 上传模块')
@ApiBearerAuth('jwt')
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @ApiOperation({ summary: '上传文件', description: 'multipart/form-data，字段名 file；仅图片，上限 10MB' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: FileUploadDto })
  @ApiOkResponse({ description: '返回文件相对路径 path，静态访问地址为 {host}{path}' })
  @Perms('tools:upload')
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_FILE_SIZE } }))
  upload(@UploadedFile() file: Express.Multer.File, @Request() req: { user?: { id: string } }) {
    return this.uploadService.saveFile(file, req.user?.id)
  }
}
