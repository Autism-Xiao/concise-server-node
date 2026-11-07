import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { LEGACY_ROUTES_ENABLED } from '../../../config/legacy-routes.config'
import { StorageEntity } from './storage.entity'
import { StorageController } from './storage.controller'
import { StorageService } from './storage.service'

/** 存储模块：tool_storage 记录管理，被 UploadModule 依赖 */
@Module({
  imports: [TypeOrmModule.forFeature([StorageEntity])],
  controllers: [...(LEGACY_ROUTES_ENABLED ? [StorageController] : [])],
  providers: [StorageService],
  exports: [StorageService]
})
export class StorageModule {}
