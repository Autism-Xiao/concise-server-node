import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'

import { deleteFile } from '../../../utils/file.util'
import { paginate, type Pagination } from '../../../helper/paginate'
import { StorageEntity } from './storage.entity'

/**
 * 文件存储服务：tool_storage 记录的查询与删除
 * 删除时同步清理本地文件，文件丢失不阻断记录删除
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name)

  constructor(
    @InjectRepository(StorageEntity)
    private readonly storageRepository: Repository<StorageEntity>
  ) {}

  /** 保存一条上传记录 */
  async save(record: StorageEntity): Promise<StorageEntity> {
    return this.storageRepository.save(record)
  }

  /** 分页查询存储记录，支持文件名/类型过滤 */
  async list(query: { page?: number; pageSize?: number; name?: string; type?: string }): Promise<Pagination<StorageEntity>> {
    const qb = this.storageRepository.createQueryBuilder('storage').orderBy('storage.id', 'DESC')
    if (query.name) {
      qb.andWhere('storage.name LIKE :name', { name: `%${query.name}%` })
    }
    if (query.type) {
      qb.andWhere('storage.type = :type', { type: query.type })
    }
    return paginate(qb, { page: query.page, pageSize: query.pageSize })
  }

  /** 批量删除记录并清理本地文件，返回删除条数 */
  async remove(ids: number[]): Promise<{ deleted: number }> {
    const records = await this.storageRepository.find({ where: { id: In(ids) } })
    for (const record of records) {
      deleteFile(record.path)
    }
    const result = await this.storageRepository.delete({ id: In(ids) })
    if (records.length !== ids.length) {
      this.logger.warn(`存储记录删除请求 ${ids.length} 条，实际存在 ${records.length} 条`)
    }
    return { deleted: result.affected ?? 0 }
  }

  /** 存储记录详情，不存在抛 404 */
  async findOne(id: number): Promise<StorageEntity> {
    const record = await this.storageRepository.findOne({ where: { id } })
    if (!record) {
      throw new NotFoundException('文件记录不存在')
    }
    return record
  }
}
