import { Injectable, BadRequestException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { BaseService } from '../../../helper/crud/base.service'
import { paginate, type Pagination } from '../../../helper/paginate'
import { DictItemEntity } from '../dict-item/entities/dict-item.entity'
import { DictTypeEntity } from './entities/dict-type.entity'

@Injectable()
export class DictTypeService extends BaseService<DictTypeEntity> {
  constructor(
    @InjectRepository(DictTypeEntity)
    repository: Repository<DictTypeEntity>
  ) {
    super(repository, '字典类型')
  }

  /** 创建：编码唯一性校验（数据库也有唯一索引兜底） */
  async create(dto: Partial<DictTypeEntity>): Promise<DictTypeEntity> {
    const exists = await this.repository.findOne({ where: { code: dto.code! } })
    if (exists) {
      throw new BadRequestException(`字典编码 ${dto.code} 已存在`)
    }
    return super.create(dto)
  }

  /** 更新：改编码时同样校验唯一性 */
  async update(id: number, dto: Partial<DictTypeEntity>): Promise<DictTypeEntity> {
    if (dto.code) {
      const exists = await this.repository.findOne({ where: { code: dto.code } })
      if (exists && exists.id !== id) {
        throw new BadRequestException(`字典编码 ${dto.code} 已存在`)
      }
    }
    return super.update(id, dto)
  }

  /** 删除：字典类型下还有字典项时拒绝删除 */
  async delete(id: number): Promise<void> {
    await this.findOne(id)
    const itemCount = await this.repository.manager.count(DictItemEntity, { where: { dictTypeId: id } })
    if (itemCount > 0) {
      throw new BadRequestException('该字典类型下存在字典项，无法删除')
    }
    await super.delete(id)
  }

  /** 分页列表：keyword 模糊匹配名称/编码 */
  async listByQuery(query: { page?: number; pageSize?: number; keyword?: string; status?: number }): Promise<Pagination<DictTypeEntity>> {
    const qb = this.repository.createQueryBuilder('type').orderBy('type.id', 'DESC')
    if (query.keyword) {
      qb.andWhere('(type.name LIKE :keyword OR type.code LIKE :keyword)', { keyword: `%${query.keyword}%` })
    }
    if (query.status !== undefined) {
      qb.andWhere('type.status = :status', { status: query.status })
    }
    return paginate(qb, { page: query.page, pageSize: query.pageSize })
  }
}
