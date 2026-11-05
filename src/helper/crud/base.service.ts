import { Injectable, NotFoundException } from '@nestjs/common'
import type { DeepPartial, FindOptionsWhere, ObjectLiteral, Repository } from 'typeorm'

import { randomId32 } from '../../utils/password.util'
import { paginate, type PaginateOptions, type Pagination } from '../paginate'

/**
 * 通用 CRUD 基类
 * 参照 nest-admin 的 BaseService：业务 Service 继承后即拥有分页列表、
 * 单查、创建、更新、删除五个通用能力，只需传入 Entity 类与 Repository
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
    return paginate(qb, options)
  }

  /** 按 id 查找，不存在时抛 404 */
  async findOne(id: number | string): Promise<T> {
    const entity = await this.repository.findOne({
      where: { id } as FindOptionsWhere<T>
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
    await this.repository.update(id, payload as never)
    return this.findOne(id)
  }

  /** 按 id 删除，不存在时抛 404 */
  async delete(id: number | string): Promise<void> {
    const result = await this.repository.delete(id)
    if (!result.affected) {
      throw new NotFoundException(`${this.entityName}不存在`)
    }
  }
}
