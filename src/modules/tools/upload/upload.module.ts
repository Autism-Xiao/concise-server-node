import { Module } from '@nestjs/common'

import { StorageModule } from '../storage/storage.module'
import { UploadService } from './upload.service'
import { UploadV1Controller } from './upload.v1.controller'

/** 上传模块：文件落盘 + 写入存储记录，依赖 StorageModule */
@Module({
  imports: [StorageModule],
  controllers: [UploadV1Controller],
  providers: [UploadService]
})
export class UploadModule {}
