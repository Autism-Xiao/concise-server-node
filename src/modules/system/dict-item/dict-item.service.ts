import { Injectable, BadRequestException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { BaseService } from '../../../helper/crud/base.service'
import { paginate, type Pagination } from '../../../helper/paginate'
import { DictItemEntity } from './entities/dict-item.entity'
import { DictTypeEntity } from '../dict-type/entities/dict-type.entity'

@Injectable()
export class DictItemService extends BaseService<DictItemEntity> {
  constructor(
    @InjectRepository(DictItemEntity)
    private readonly repository2: Repository<DictItemEntity>,
    @InjectRepository(DictTypeEntity)
    private readonly dictTypeRepository: Repository<DictTypeEntity>
  ) {
    super(repository2, '字典项')
  }

  /** 创建：校验字典类型存在 + 同类型下 value 唯一 */
  async create(dto: Partial<DictItemEntity>): Promise<DictItemEntity> {
    await this.ensureTypeExists(dto.dictTypeId!)
    await this.ensureValueUnique(dto.dictTypeId!, dto.value!)
    return super.create(dto)
  }

  /** 更新：value 或类型变化时重新校验 */
  async update(id: number, dto: Partial<DictItemEntity>): Promise<DictItemEntity> {
    const item = await this.findOne(id)
    const dictTypeId = dto.dictTypeId ?? item.dictTypeId
    const value = dto.value ?? item.value
    if (dto.dictTypeId !== undefined) {
      await this.ensureTypeExists(dictTypeId)
    }
    if (dto.value !== undefined || dto.dictTypeId !== undefined) {
      await this.ensureValueUnique(dictTypeId, value, id)
    }
    return super.update(id, dto)
  }

  /** 分页列表：按类型过滤 + keyword 模糊匹配标签/值 */
  async listByQuery(query: { page?: number; pageSize?: number; dictTypeId?: number; keyword?: string; status?: number }): Promise<Pagination<DictItemEntity>> {
    const qb = this.repository2.createQueryBuilder('item').orderBy('item.sort', 'ASC').addOrderBy('item.id', 'ASC')
    if (query.dictTypeId !== undefined) {
      qb.andWhere('item.dictTypeId = :dictTypeId', { dictTypeId: query.dictTypeId })
    }
    if (query.keyword) {
      qb.andWhere('(item.label LIKE :keyword OR item.value LIKE :keyword)', { keyword: `%${query.keyword}%` })
    }
    if (query.status !== undefined) {
      qb.andWhere('item.status = :status', { status: query.status })
    }
    return paginate(qb, { page: query.page, pageSize: query.pageSize })
  }

  /** 按字典编码取启用状态的字典项（前端下拉框数据源，一次返回不分页） */
  async listByTypeCode(code: string): Promise<{ code: string; name: string; items: Pick<DictItemEntity, 'label' | 'value' | 'sort' | 'remark'>[] }> {
    const dictType = await this.dictTypeRepository.findOne({ where: { code, status: 1 } })
    if (!dictType) {
      throw new BadRequestException(`字典 ${code} 不存在或已禁用`)
    }
    const items = await this.repository2.find({
      where: { dictTypeId: dictType.id, status: 1 },
      select: { label: true, value: true, sort: true, remark: true },
      order: { sort: 'ASC', id: 'ASC' }
    })
    return { code: dictType.code, name: dictType.name, items }
  }

  private async ensureTypeExists(dictTypeId: number): Promise<void> {
    const exists = await this.dictTypeRepository.findOne({ where: { id: dictTypeId } })
    if (!exists) {
      throw new BadRequestException('所属字典类型不存在')
    }
  }

  private async ensureValueUnique(dictTypeId: number, value: string, excludeId?: number): Promise<void> {
    const qb = this.repository2.createQueryBuilder('item').where('item.dictTypeId = :dictTypeId', { dictTypeId }).andWhere('item.value = :value', { value })
    if (excludeId) {
      qb.andWhere('item.id != :excludeId', { excludeId })
    }
    if (await qb.getOne()) {
      throw new BadRequestException(`该字典类型下已存在值为 ${value} 的字典项`)
    }
  }
}
