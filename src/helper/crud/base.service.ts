import { Injectable, NotFoundException } from '@nestjs/common'
import type { DeepPartial, FindOptionsWhere, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm'

import { randomId32 } from '../../utils/password.util'
import { emitChanges, shouldSkipField, toComparable, type ChangeItem } from '../../shared/audit/change-recorder'
import { TenantContext } from '../../shared/tenant/tenant.context'
import { SHARED_TENANT_ID, tenantRawCondition, tenantWriteCondition } from '../../shared/tenant/tenant-scope.util'
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

  /**
   * 写入时打上当前租户（实体有 tenant_id 列且调用方没显式指定）
   *
   * 平台视角（tenantId=null）也要显式打 0（平台共享），不能留空让 DB 列默认值兜底——
   * 历史上多张业务表列默认值是 1（单租户时代遗留），超管在平台视角创建的公告/任务
   * 会被错归到租户 1，其他租户看不见。即使列默认值已统一改成 0，这里仍显式打标，
   * 不再依赖列默认值（防御纵深）。
   */
  private stampTenant(entity: T): void {
    if (!this.hasTenantColumn()) return
    if ((entity as Record<string, unknown>).tenantId !== undefined) return
    const tenantId = TenantContext.filterTenantId()
    Object.assign(entity, { tenantId: tenantId ?? SHARED_TENANT_ID })
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
    const before = await this.findOne(id)
    const shouldStamp = this.hasProperty('updateTime') && (dto as Record<string, unknown>).updateTime === undefined
    const payload = shouldStamp ? ({ ...dto, updateTime: new Date() } as DeepPartial<T>) : dto
    const qb = this.repository
      .createQueryBuilder()
      .update()
      .set(payload as never)
      .where('id = :id', { id })
    // 写路径用严格租户条件（不含 tenant_id=0 共享行）：共享数据只有平台视角能改，
    // 否则租户管理员能通过「先读到共享行再按 id 写」改掉平台数据
    if (this.hasTenantColumn()) {
      const condition = tenantWriteCondition()
      if (condition) qb.andWhere(condition.clause, condition.params)
    }
    const result = await qb.execute()
    if (!result.affected) {
      // 没写进去 = 行不存在或不在本租户可写范围内，按 404 处理（不能返回没变化的旧数据假装成功）
      throw new NotFoundException(`${this.entityName}不存在`)
    }
    this.emitChangeDiff(before, payload)
    return this.findOne(id)
  }

  /**
   * 子类自己写 update（不走 super.update）时，手动调一下这个把变更交给审计。
   *
   * 必须显式调的原因：`emitChangeDiff` 挂在 `super.update()` 里，凡是自己用
   * QueryBuilder/事务直接写库、没调 super 的子类（如 UserService）都不会自动触发。
   * 参数 before 是**更新前**查出来的实体，patch 是实际要写库的字段集合。
   */
  protected auditUpdate(before: T, patch: Partial<T>): void {
    this.emitChangeDiff(before, patch as DeepPartial<T>)
  }

  /**
   * 把「改了哪些字段、改前改后是什么」交给审计采集器。
   *
   * 只处理本次 payload 里出现过的字段（没传的字段 = 没改，不算变更）；
   * 敏感字段（password/salt/secret/token 等）在采集器里被过滤掉，不会落库。
   * 采集是即发即忘，失败不影响这次更新。
   */
  private emitChangeDiff(before: T, payload: DeepPartial<T>): void {
    const patch = payload as Record<string, unknown>
    const fields = Object.keys(patch)
    if (!fields.length) return
    const recordId = (before as unknown as { id: number | string }).id
    const items: ChangeItem[] = []
    for (const field of fields) {
      if (shouldSkipField(field)) continue
      const next = patch[field]
      if (next === undefined) continue
      const oldText = toComparable((before as Record<string, unknown>)[field])
      const newText = toComparable(next)
      if (oldText === newText) continue
      items.push({
        table: this.repository.metadata.tableName,
        recordId: String(recordId),
        field,
        // 列上的 comment 就是中文名（建表/实体里都写了），顺手当标签用
        label: this.repository.metadata.findColumnWithPropertyName(field)?.comment ?? undefined,
        oldValue: oldText,
        newValue: newText
      })
    }
    emitChanges(items)
  }

  /** 按 id 删除，不存在时抛 404（严格租户条件：共享行 / 跨租户行一律不可删） */
  async delete(id: number | string): Promise<void> {
    const qb = this.repository.createQueryBuilder().delete().where('id = :id', { id })
    if (this.hasTenantColumn()) {
      const condition = tenantWriteCondition()
      if (condition) qb.andWhere(condition.clause, condition.params)
    }
    const result = await qb.execute()
    if (!result.affected) {
      throw new NotFoundException(`${this.entityName}不存在`)
    }
  }
}
