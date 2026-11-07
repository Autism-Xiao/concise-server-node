import { BadRequestException, Controller, Post, Request, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiExcludeController, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Perms } from '../../../common/decorators/perms.decorator'
import { RateLimit } from '../../../common/decorators/rate-limit.decorator'
import { FileUploadDto } from './upload.dto'
import { UploadService } from './upload.service'

/** 与参考项目一致：仅图片，上限 10MB */
export const UPLOAD_FILE_SIZE = 10 * 1024 * 1024

/**
 * 允许的 MIME 白名单
 *
 * 注意：Content-Type 由客户端填写、可任意伪造，这里只是第一道门；
 * 真正的判定在 UploadService 里按文件头（magic bytes）复核，两者不一致直接拒绝。
 *
 * 刻意**不含 image/svg+xml**：SVG 是 XML，可内嵌 <script>/onload，
 * 与本服务同源静态托管时会变成存储型 XSS（可直接读取 localStorage 里的 token）。
 */
export const UPLOAD_MIMETYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp']

/** multer 文件过滤：先按声明的 Content-Type 拦一遍，非图片不落盘（不占磁盘、不进内存缓冲） */
export function imageFileFilter(_request: unknown, file: Express.Multer.File, callback: (error: Error | null, acceptFile: boolean) => void): void {
  const declared = (file.mimetype ?? '').toLowerCase()
  if (!UPLOAD_MIMETYPES.includes(declared)) {
    callback(new BadRequestException(`仅支持上传 PNG / JPEG / GIF / WEBP / BMP 图片，当前文件类型为「${declared || '未知'}」`), false)
    return
  }
  callback(null, true)
}

// 旧版无前缀接口：仅为向后兼容保留，不出现在 Swagger 文档中（文档只暴露 V1 + 系统分组）
@ApiExcludeController()
@ApiTags('工具 - 上传模块')
@ApiBearerAuth('jwt')
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @ApiOperation({
    summary: '上传图片',
    description: 'multipart/form-data，字段名 file；仅 PNG/JPEG/GIF/WEBP/BMP，按文件头校验真实类型，上限 10MB'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: FileUploadDto })
  @ApiOkResponse({ description: '返回文件相对路径 path，静态访问地址为 {host}{path}' })
  @Perms('tools:upload')
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
