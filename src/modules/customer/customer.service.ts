import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { isDuplicateEntryError } from '../../utils/db-error.util'
import { BaseService } from '../../helper/crud/base.service'
import { applySort, paginate, type Pagination } from '../../helper/paginate'
import { TenantContext } from '../../shared/tenant/tenant.context'
import { createTenantQb } from '../../shared/tenant/tenant-qb.factory'
import { applyOwnerScope, type OwnerScopeActor } from '../../shared/permission/owner-scope.util'
import { CreateCustomerDto, ListCustomerDto, UpdateCustomerDto } from './dto/customer.dto'
import { CustomerEntity } from './entities/customer.entity'

/** 可排序字段白名单：前端列 id → 实体属性名 */
const CUSTOMER_SORTABLE: Record<string, string> = {
  name: 'name',
  contact: 'contact',
  phone: 'phone',
  level: 'level',
  vip: 'vip',
  createdAt: 'createdAt'
}

@Injectable()
export class CustomerService extends BaseService<CustomerEntity> {
  /** 唯一字段列名；查重必须含软删行（软删行仍占用数据库唯一键，不能过滤 del_flag） */
  private readonly uniqueFields: readonly string[] = ['phone']

  private readonly uniqueLabels: Record<string, string> = {
    phone: '电话'
  }

  constructor(
    @InjectRepository(CustomerEntity)
    repository: Repository<CustomerEntity>
  ) {
    super(repository, '客户')
  }

  /** 唯一键查重：excludeId 供更新时排除自身；按租户作用域查（唯一键也是 (tenant_id, 字段)） */
  private async assertUnique(field: string, value: string | number, excludeId?: number): Promise<void> {
    const qb = createTenantQb(this.repository, 't').where('t.' + field + ' = :value', { value })
    if (excludeId !== undefined) qb.andWhere('t.id != :excludeId', { excludeId })
    const exists = await qb.getOne()
    if (exists) throw new BadRequestException(`${this.uniqueLabels[field] ?? field}「${value}」已存在`)
  }

  private async assertAllUnique(dto: object, excludeId?: number): Promise<void> {
    const record = dto as Record<string, unknown>
    for (const field of this.uniqueFields) {
      const value = record[field]
      if (value !== undefined && value !== null && value !== '') {
        await this.assertUnique(field, value as string | number, excludeId)
      }
    }
  }

  /** 分页列表：keyword（模糊）；角色 data_scope=仅本人时按 createBy 收窄 */
  async listByQuery(query: ListCustomerDto, actor?: OwnerScopeActor | null): Promise<Pagination<CustomerEntity>> {
    const qb = createTenantQb(this.repository, 'customer').orderBy('customer.id', 'DESC')
    qb.andWhere('customer.delFlag = 0')
    applyOwnerScope(qb, 'customer', actor)
    applySort(qb, 'customer', query, CUSTOMER_SORTABLE)
    if (query.keyword) {
      qb.andWhere('customer.name LIKE :keyword', { keyword: `%${query.keyword}%` })
    }

    return paginate(qb, { page: query.page, pageSize: query.pageSize })
  }

  /** 新增：唯一键查重 + 落 createBy；并发写兜底捕获 ER_DUP_ENTRY 转 400 */
  async create(dto: CreateCustomerDto): Promise<CustomerEntity> {
    await this.assertAllUnique(dto)
    try {
      return await super.create({ ...dto, createBy: TenantContext.userId() })
    } catch (error) {
      if (isDuplicateEntryError(error)) {
        throw new BadRequestException('客户与已有数据冲突（唯一约束），请检查电话是否重复')
      }
      throw error
    }
  }

  /** 修改：唯一键查重（排除自身）+ 落 updateBy */
  async update(id: number, dto: UpdateCustomerDto): Promise<CustomerEntity> {
    await this.findOne(id)
    await this.assertAllUnique(dto, id)
    try {
      return await super.update(id, { ...dto, updateBy: TenantContext.userId() })
    } catch (error) {
      if (isDuplicateEntryError(error)) {
        throw new BadRequestException('客户与已有数据冲突（唯一约束），请检查电话是否重复')
      }
      throw error
    }
  }

  /** 软删除：del_flag 置 1；软删行仍占用唯一键，与查重「含软删占用」配套 */
  async delete(id: number): Promise<void> {
    // 必须走基类的严格写条件：findOne 能读到 tenant_id=0 的共享客户，按 id 直写会删掉平台数据
    await this.softDelete(id, { delFlag: 1 })
  }
}
