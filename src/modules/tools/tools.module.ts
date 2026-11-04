import { Module } from '@nestjs/common'

import { StorageModule } from './storage/storage.module'
import { UploadModule } from './upload/upload.module'

/** 工具模块聚合：公共接口（上传、存储等），参照 nest-admin 的 modules/tools */
@Module({
  imports: [UploadModule, StorageModule]
})
export class ToolsModule {}
