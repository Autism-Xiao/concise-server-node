import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { FileCleaner } from './file.cleaner'
import { FileEntity } from './entities/file.entity'
import { FileV1Controller } from './file.v1.controller'
import { FileService } from './file.service'

/** 文件管理模块：sys_file 目录树 + 上传下载，独立于旧的 tool_storage（附件）体系 */
@Module({
  imports: [TypeOrmModule.forFeature([FileEntity])],
  controllers: [FileV1Controller],
  providers: [FileService, FileCleaner],
  exports: [FileService]
})
export class FileModule {}
