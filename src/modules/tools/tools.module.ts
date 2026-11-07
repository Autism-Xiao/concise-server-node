import { Module } from '@nestjs/common'

import { FileModule } from './file/file.module'
import { StorageModule } from './storage/storage.module'
import { UploadModule } from './upload/upload.module'

/**
 * 工具模块聚合
 * - upload / storage：旧的「附件」体系（头像、富文本图片，落 public/upload 静态托管）
 * - file：文件管理（个人网盘，逻辑目录 + 内容寻址存储，不走静态托管）
 */
@Module({
  imports: [UploadModule, StorageModule, FileModule]
})
export class ToolsModule {}
