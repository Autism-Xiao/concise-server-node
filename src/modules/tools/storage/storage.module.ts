import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { StorageEntity } from './storage.entity'
import { StorageService } from './storage.service'

/** 存储模块：tool_storage 记录管理，被 UploadModule 依赖 */
@Module({
  imports: [TypeOrmModule.forFeature([StorageEntity])],
  controllers: [],
  providers: [StorageService],
  exports: [StorageService]
})
export class StorageModule {}
