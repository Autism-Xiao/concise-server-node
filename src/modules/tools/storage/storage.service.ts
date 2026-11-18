import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { StorageEntity } from './storage.entity'

/**
 * 文件存储服务：tool_storage 记录的写入
 *
 * 历史说明：旧版 `/api/storage/**` 查询/删除接口已随 LEGACY_ROUTES_ENABLED 一起下线，
 * 本服务仅保留上传链路需要的 save()。
 */
@Injectable()
export class StorageService {
  constructor(
    @InjectRepository(StorageEntity)
    private readonly storageRepository: Repository<StorageEntity>
  ) {}

  /** 保存一条上传记录 */
  async save(record: StorageEntity): Promise<StorageEntity> {
    return this.storageRepository.save(record)
  }
}
