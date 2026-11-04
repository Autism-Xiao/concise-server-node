import { Module } from '@nestjs/common'

import { StorageModule } from '../storage/storage.module'
import { UploadController } from './upload.controller'
import { UploadService } from './upload.service'

/** 上传模块：文件落盘 + 写入存储记录，依赖 StorageModule */
@Module({
  imports: [StorageModule],
  controllers: [UploadController],
  providers: [UploadService]
})
export class UploadModule {}
