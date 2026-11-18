import { HttpStatus } from '@nestjs/common'

import { BizErrorCode } from '../../../common/enums/biz-error-code.enum'
import { BizException } from '../../../common/exceptions/biz.exception'

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
    callback(
      new BizException(
        BizErrorCode.UPLOAD_TYPE_REJECTED,
        `仅支持上传 PNG / JPEG / GIF / WEBP / BMP 图片，当前文件类型为「${declared || '未知'}」`,
        HttpStatus.BAD_REQUEST
      ),
      false
    )
    return
  }
  callback(null, true)
}
