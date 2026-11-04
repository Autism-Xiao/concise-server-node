import { Injectable, NotFoundException } from '@nestjs/common'

import { StorageEntity } from '../storage/storage.entity'
import { StorageService } from '../storage/storage.service'
import { fileRename, getExtname, getCurrentDate, getFilePath, getFileType, getSize, saveLocalFile } from '../../../utils/file.util'

/**
 * 上传服务：文件重命名落盘 public/upload/{日期}/{类型}/，并写入 tool_storage 记录
 * 参照 nest-admin 的 tools/upload 结构，multer 文件由控制器传入
 */
@Injectable()
export class UploadService {
  constructor(private readonly storageService: StorageService) {}

  /** 保存一个上传文件，返回相对访问路径（静态目录挂载在 /public） */
  async saveFile(file: Express.Multer.File | undefined, userId?: number): Promise<{ path: string }> {
    if (!file) {
      throw new NotFoundException('未找到上传文件')
    }
    const fileName = file.originalname
    const size = getSize(file.size)
    const extName = getExtname(fileName)
    const type = getFileType(extName)
    const name = fileRename(fileName)
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
