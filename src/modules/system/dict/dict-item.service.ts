import { BadRequestException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'

import { BaseService } from '../../../helper/crud/base.service'
import { BizErrorCode } from '../../../common/enums/biz-error-code.enum'
import { BizException } from '../../../common/exceptions/biz.exception'
import { normalizeBatchIds, runBatchDelete, type BatchDeleteResult } from '../../../helper/crud/batch-delete'
import { applyTenantScope, tenantWriteCondition } from '../../../shared/tenant/tenant-scope.util'
import { TenantContext } from '../../../shared/tenant/tenant.context'
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
    applyTenantScope(qb, 'item')

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
    // 按编码取字典要带租户范围：联合唯一键 (tenant_id, dict_code) 允许租户间重码，
    // 不加范围的话撞码时取到哪条全凭运气；租户视角「本租户 ∪ 平台共享」内编码不会歧义
    const dictQb = this.dictRepository.createQueryBuilder('dict').where('dict.dict_code = :code', { code }).andWhere('dict.del_flag = 0')
    applyTenantScope(dictQb, 'dict')
    const dict = await dictQb.getOne()
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

  /** 字典项详情（排除已删除字典下的项；按租户范围过滤，跨租户的项视为不存在） */
  async findDetail(id: string): Promise<SysDictItemEntity> {
    const itemQb = this.itemRepository.createQueryBuilder('item').leftJoinAndSelect('item.dict', 'dict').where('item.id = :id', { id })
    applyTenantScope(itemQb, 'item')
    const item = await itemQb.getOne()
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

    const updateQb = this.itemRepository.createQueryBuilder().update(SysDictItemEntity).set(patch).where('id = :id', { id })
    // 写路径加严格租户条件：共享行只有平台视角能改
    const writeCondition = tenantWriteCondition()
    if (writeCondition) updateQb.andWhere(writeCondition.clause, writeCondition.params)
    const updateResult = await updateQb.execute()
    if (!updateResult.affected) {
      throw new NotFoundException('字典项不存在')
    }
    return this.findDetail(id)
  }

  /** 删除字典项（硬删：sys_dict_item 无 del_flag 列；严格租户条件，跨租户/共享行不可删） */
  async deleteItem(id: string): Promise<void> {
    await this.findDetail(id)
    const deleteQb = this.itemRepository.createQueryBuilder().delete().where('id = :id', { id })
    const writeCondition = tenantWriteCondition()
    if (writeCondition) deleteQb.andWhere(writeCondition.clause, writeCondition.params)
    const deleteResult = await deleteQb.execute()
    if (!deleteResult.affected) {
      throw new NotFoundException('字典项不存在')
    }
  }

  /** 所属字典必须存在、未删除且当前上下文可写（平台内置字典的字典项由平台维护） */
  private async assertDictExists(dictId: string): Promise<void> {
    const dictQb = this.dictRepository.createQueryBuilder('dict').where('dict.id = :dictId', { dictId }).andWhere('dict.del_flag = 0')
    applyTenantScope(dictQb, 'dict')
    const dict = await dictQb.getOne()
    if (!dict) {
      throw new BadRequestException('所属字典不存在或已删除')
    }
    const ctxTenantId = TenantContext.filterTenantId()
    if (ctxTenantId !== null && dict.tenantId !== ctxTenantId) {
      throw new BadRequestException('平台内置字典的字典项由平台维护，如需定制请创建租户自有字典')
    }
  }

  /** 同一字典下 itemValue 唯一 */
  private async assertValueAvailable(dictId: string, itemValue: string, excludeId?: string): Promise<void> {
    const qb = this.itemRepository.createQueryBuilder('item').where('item.dictId = :dictId', { dictId }).andWhere('item.itemValue = :itemValue', { itemValue })
    if (excludeId) {
      qb.andWhere('item.id <> :excludeId', { excludeId })
    }
    if (await qb.getExists()) {
      throw new BizException(BizErrorCode.DICT_ITEM_VALUE_CONFLICT, `该字典下已存在值为「${itemValue}」的字典项`, HttpStatus.BAD_REQUEST)
    }
  }

  /** 批量删除字典项：逐条硬删，单条失败返回原因 */
  async batchDelete(ids: string[]): Promise<BatchDeleteResult> {
    const targets = await this.itemRepository.findBy({ id: In(normalizeBatchIds(ids)) })
    return runBatchDelete(
      targets,
      {
        getId: item => item.id,
        getName: item => item.itemText,
        remove: item => this.deleteItem(item.id)
      },
      ids
    )
  }
}
