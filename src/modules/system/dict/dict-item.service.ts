import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { BaseService } from '../../../helper/crud/base.service'
import { paginate, type Pagination } from '../../../helper/paginate'
import { SysDictEntity } from './entities/sys-dict.entity'
import { SysDictItemEntity } from './entities/sys-dict-item.entity'
import type { CreateDictItemDto } from './dto/create-dict-item.dto'
import type { QueryDictItemDto } from './dto/query-dict-item.dto'
import type { UpdateDictItemDto } from './dto/update-dict-item.dto'

/** 按编码返回的字典项（前端下拉框数据源，字段精简） */
export interface DictItemOption {
  itemText: string
  itemValue: string
  sortOrder?: number
  description?: string
}

@Injectable()
export class DictItemService extends BaseService<SysDictItemEntity> {
  constructor(
    @InjectRepository(SysDictItemEntity)
    private readonly itemRepository: Repository<SysDictItemEntity>,
    @InjectRepository(SysDictEntity)
    private readonly dictRepository: Repository<SysDictEntity>
  ) {
    super(itemRepository, '字典项')
  }

  /** 分页列表：可按字典、关键字、状态过滤，按 sort_order 升序 */
  async listByQuery(query: QueryDictItemDto): Promise<Pagination<SysDictItemEntity>> {
    const qb = this.itemRepository.createQueryBuilder('item').orderBy('item.sortOrder', 'ASC').addOrderBy('item.id', 'ASC')

    if (query.dictId) {
      qb.andWhere('item.dictId = :dictId', { dictId: query.dictId })
    }
    const keyword = query.keyword?.trim()
    if (keyword) {
      qb.andWhere('(item.itemText LIKE :keyword OR item.itemValue LIKE :keyword)', { keyword: `%${keyword}%` })
    }
    if (query.status !== undefined) {
      qb.andWhere('item.status = :status', { status: query.status })
    }

    return paginate(qb, { page: query.page, pageSize: query.pageSize })
  }

  /**
   * 按字典编码取启用状态的字典项（所有登录用户可用，前端下拉框数据源）
   * 字典不存在或已删除抛 400，便于前端拿到明确提示
   */
  async listByCode(code: string): Promise<{ dictId: string; dictCode: string; dictName: string; type: number; items: DictItemOption[] }> {
    const dict = await this.dictRepository.findOne({ where: { dictCode: code, delFlag: 0 } })
    if (!dict) {
      throw new BadRequestException(`字典「${code}」不存在或已删除`)
    }

    const items = await this.itemRepository.find({
      where: { dictId: dict.id, status: 1 },
      order: { sortOrder: 'ASC', id: 'ASC' }
    })

    return {
      dictId: dict.id,
      dictCode: dict.dictCode,
      dictName: dict.dictName,
      type: dict.type,
      items: items.map(item => ({ itemText: item.itemText, itemValue: item.itemValue, sortOrder: item.sortOrder, description: item.description }))
    }
  }

  /** 字典项详情（排除已删除字典下的项） */
  async findDetail(id: string): Promise<SysDictItemEntity> {
    const item = await this.itemRepository.findOne({ where: { id }, relations: { dict: true } })
    if (!item || item.dict?.delFlag === 1) {
      throw new NotFoundException('字典项不存在')
    }
    return item
  }

  /** 创建字典项：所属字典必须存在，同一字典下 itemValue 唯一 */
  async createItem(dto: CreateDictItemDto, operator?: string): Promise<SysDictItemEntity> {
    await this.assertDictExists(dto.dictId)
    await this.assertValueAvailable(dto.dictId, dto.itemValue)

    return this.create({
      dictId: dto.dictId,
      itemText: dto.itemText,
      itemValue: dto.itemValue,
      sortOrder: dto.sortOrder ?? 0,
      status: dto.status ?? 1,
      description: dto.description,
      createBy: operator,
      createTime: new Date()
    })
  }

  /** 更新字典项：换字典或改值时重新校验 */
  async updateItem(id: string, dto: UpdateDictItemDto, operator?: string): Promise<SysDictItemEntity> {
    const before = await this.findDetail(id)
    const dictId = dto.dictId ?? before.dictId
    const itemValue = dto.itemValue ?? before.itemValue

    if (dto.dictId !== undefined) {
      await this.assertDictExists(dictId)
    }
    if (dto.dictId !== undefined || dto.itemValue !== undefined) {
      await this.assertValueAvailable(dictId, itemValue, id)
    }

    const patch: Record<string, unknown> = {}
    if (dto.dictId !== undefined) patch.dictId = dto.dictId
    if (dto.itemText !== undefined) patch.itemText = dto.itemText
    if (dto.itemValue !== undefined) patch.itemValue = dto.itemValue
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder
    if (dto.status !== undefined) patch.status = dto.status
    if (dto.description !== undefined) patch.description = dto.description || null
    patch.updateBy = operator ?? null
    patch.updateTime = new Date()

    await this.itemRepository.createQueryBuilder().update(SysDictItemEntity).set(patch).where('id = :id', { id }).execute()
    return this.findDetail(id)
  }

  /** 删除字典项（硬删：JeecgBoot 的 sys_dict_item 没有 del_flag） */
  async deleteItem(id: string): Promise<void> {
    await this.findDetail(id)
    await this.itemRepository.delete(id)
  }

  /** 所属字典必须存在且未删除 */
  private async assertDictExists(dictId: string): Promise<void> {
    const dict = await this.dictRepository.findOne({ where: { id: dictId, delFlag: 0 } })
    if (!dict) {
      throw new BadRequestException('所属字典不存在或已删除')
    }
  }

  /** 同一字典下 itemValue 唯一 */
  private async assertValueAvailable(dictId: string, itemValue: string, excludeId?: string): Promise<void> {
    const qb = this.itemRepository.createQueryBuilder('item').where('item.dictId = :dictId', { dictId }).andWhere('item.itemValue = :itemValue', { itemValue })
    if (excludeId) {
      qb.andWhere('item.id <> :excludeId', { excludeId })
    }
    if (await qb.getExists()) {
      throw new BadRequestException(`该字典下已存在值为「${itemValue}」的字典项`)
    }
  }
}
