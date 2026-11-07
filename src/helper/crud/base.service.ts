import { Injectable, NotFoundException } from '@nestjs/common'
import type { DeepPartial, FindOptionsWhere, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm'

import { randomId32 } from '../../utils/password.util'
import { TenantContext } from '../../shared/tenant/tenant.context'
import { tenantRawCondition } from '../../shared/tenant/tenant-scope.util'
import { paginate, type PaginateOptions, type Pagination } from '../paginate'

/**
 * 通用 CRUD 基类
 * 参照 nest-admin 的 BaseService：业务 Service 继承后即拥有分页列表、
 * 单查、创建、更新、删除五个通用能力，只需传入 Entity 类与 Repository
 *
 * **多租户**：实体带 `tenantId` 列时自动按当前租户隔离（读过滤 + 写打标），
 * 判断依据是实体元数据，所以不带 tenant_id 的全局表（sys_user / sys_permission）行为不变。
 * 规则见 shared/tenant/tenant-scope.util.ts：tenant_id = 0 是平台共享数据，所有租户可见。
 */
@Injectable()
export class BaseService<T extends ObjectLiteral & { id: number | string }> {
  constructor(
    protected readonly repository: Repository<T>,
    /** 实体展示名（用于 404 提示，如 "用户"） */
    protected readonly entityName = '资源'
  ) {}

  /** 分页列表 */
  async list(options: PaginateOptions = {}): Promise<Pagination<T>> {
    const qb = this.repository.createQueryBuilder('entity')
    this.applyTenantToQuery(qb, 'entity')
    return paginate(qb, options)
  }

  /** 按 id 查找，不存在时抛 404（不在当前租户范围内同样视为不存在，不泄漏存在性） */
  async findOne(id: number | string): Promise<T> {
    const entity = await this.repository.findOne({
      where: this.withTenantWhere({ id } as FindOptionsWhere<T>)
    })
    if (!entity) {
      throw new NotFoundException(`${this.entityName}不存在`)
    }
    return entity
  }

  /** 创建：字符串主键自动生成 32 位 id（数字自增主键不干预）；实体有 createTime 列且未显式传入时自动补当前时间 */
  async create(dto: DeepPartial<T>): Promise<T> {
    const entity = this.repository.create(dto)
    if (!entity.id && this.hasStringPrimaryKey()) {
      Object.assign(entity, { id: randomId32() })
    }
    this.stampTenant(entity)
    this.stampCreateIfMissing(entity)
    return this.repository.save(entity)
  }

  /** 主键是否为字符串列（varchar/char）——用于决定是否自动生成 id */
  private hasStringPrimaryKey(): boolean {
    const column = this.repository.metadata.findColumnWithPropertyName('id')
    return !!column && (column.type === 'varchar' || column.type === 'char')
  }

  /** 实体是否有指定属性名的列 */
  private hasProperty(name: string): boolean {
    return !!this.repository.metadata.findColumnWithPropertyName(name)
  }

  /** 实体是否按租户隔离（有 tenant_id 列） */
  protected hasTenantColumn(): boolean {
    return this.hasProperty('tenantId')
  }

  /** 给 SELECT 类查询补租户条件（子类自定义 QueryBuilder 时也调用它） */
  protected applyTenantToQuery<Q extends ObjectLiteral>(qb: SelectQueryBuilder<Q>, alias: string): void {
    if (!this.hasTenantColumn()) return
    const condition = tenantRawCondition(`${alias}.tenant_id`)
    if (condition) qb.andWhere(condition.clause, condition.params)
  }

  /**
   * 把租户条件并进 where：
   * - 不过滤 → 原样
   * - 单租户 → `{ id, tenantId }`
   * - 带共享数据 → `[{ id, tenantId }, { id, tenantId: 0 }]`（TypeORM 的数组 where 即 OR）
   */
  private withTenantWhere(where: FindOptionsWhere<T>): FindOptionsWhere<T> | FindOptionsWhere<T>[] {
    if (!this.hasTenantColumn()) return where
    const tenantId = TenantContext.filterTenantId()
    if (tenantId === null) return where
    if (tenantId === 0) return [{ ...where, tenantId: 0 } as FindOptionsWhere<T>]
    return [{ ...where, tenantId } as FindOptionsWhere<T>, { ...where, tenantId: 0 } as FindOptionsWhere<T>]
  }

  /** 写入时打上当前租户（实体有 tenant_id 列且调用方没显式指定） */
  private stampTenant(entity: T): void {
    if (!this.hasTenantColumn()) return
    if ((entity as Record<string, unknown>).tenantId !== undefined) return
    const tenantId = TenantContext.filterTenantId()
    if (tenantId !== null) Object.assign(entity, { tenantId })
  }

  /** createTime 列存在且实体上未赋值时补 new Date()；显式传入（含 @CreateDateColumn 实体）不覆盖 */
  private stampCreateIfMissing(entity: T): void {
    if (!this.hasProperty('createTime')) {
      return
    }
    if ((entity as Record<string, unknown>).createTime === undefined) {
      Object.assign(entity, { createTime: new Date() })
    }
  }

  /** 按 id 更新：实体有 updateTime 列且调用方未显式传入时自动补当前时间 */
  async update(id: number | string, dto: DeepPartial<T>): Promise<T> {
    await this.findOne(id)
    const shouldStamp = this.hasProperty('updateTime') && (dto as Record<string, unknown>).updateTime === undefined
    const payload = shouldStamp ? ({ ...dto, updateTime: new Date() } as DeepPartial<T>) : dto
    const qb = this.repository
      .createQueryBuilder()
      .update()
      .set(payload as never)
      .where('id = :id', { id })
    if (this.hasTenantColumn()) {
      const condition = tenantRawCondition()
      if (condition) qb.andWhere(condition.clause, condition.params)
    }
    await qb.execute()
    return this.findOne(id)
  }

  /** 按 id 删除，不存在时抛 404（同样带租户条件，避免跨租户误删） */
  async delete(id: number | string): Promise<void> {
    const qb = this.repository.createQueryBuilder().delete().where('id = :id', { id })
    if (this.hasTenantColumn()) {
      const condition = tenantRawCondition()
      if (condition) qb.andWhere(condition.clause, condition.params)
    }
    const result = await qb.execute()
    if (!result.affected) {
      throw new NotFoundException(`${this.entityName}不存在`)
    }
  }
}
