import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common'

import { BizErrorCode } from '../../../common/enums/biz-error-code.enum'
import { BizException } from '../../../common/exceptions/biz.exception'
import { StorageEntity } from '../storage/storage.entity'
import { StorageService } from '../storage/storage.service'
import { fileRename, getCurrentDate, getFilePath, getFileType, getSize, saveLocalFile } from '../../../utils/file.util'
import { detectImageSignature } from '../../../utils/image-signature.util'

/**
 * 上传服务：文件重命名落盘 public/upload/{日期}/{类型}/，并写入 tool_storage 记录
 * 参照 nest-admin 的 tools/upload 结构，multer 文件由控制器传入
 *
 * 安全要点（存储型 XSS 的正面防线）：
 * 1. 只接受图片，且以文件头为准 —— 把 .html 改名成 .png 同样会被识破；
 * 2. 落盘扩展名用「识别出的真实类型」，不信任原始文件名；
 * 3. 原始文件名先做目录穿越清洗（../ 之类的路径会被剥掉）。
 */
@Injectable()
export class UploadService {
  constructor(private readonly storageService: StorageService) {}

  /** 保存一个上传文件，返回相对访问路径（静态目录挂载在 /public） */
  async saveFile(file: Express.Multer.File | undefined, userId?: string): Promise<{ path: string }> {
    if (!file) {
      throw new NotFoundException('未找到上传文件')
    }

    // 文件头复核：声明 image/png 但内容其实是 HTML 的，在这里被拦下
    const signature = detectImageSignature(file.buffer)
    if (!signature) {
      throw new BizException(BizErrorCode.UPLOAD_SIGNATURE_MISMATCH, '文件内容不是有效的图片，仅支持 PNG / JPEG / GIF / WEBP / BMP', HttpStatus.BAD_REQUEST)
    }

    const fileName = file.originalname
    const size = getSize(file.size)
    // 扩展名取识别结果，避免「.html 里装着 png」这类伪装落盘
    const extName = signature.ext
    const type = getFileType(extName)
    const name = fileRename(fileName, extName)
    const currentDate = getCurrentDate()
    const path = getFilePath(name, currentDate, type)

    await saveLocalFile(file.buffer, name, currentDate, type)

    const record = new StorageEntity()
    record.name = name
    record.fileName = fileName
    record.extName = extName
    record.path = path
    record.type = type
    record.size = size
    record.userId = userId
    await this.storageService.save(record)

    return { path }
  }
}
