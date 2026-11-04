import { Injectable, NotFoundException } from '@nestjs/common'
import type { DeepPartial, FindOptionsWhere, ObjectLiteral, Repository } from 'typeorm'

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

  /** 创建 */
  async create(dto: DeepPartial<T>): Promise<T> {
    const entity = this.repository.create(dto)
    return this.repository.save(entity)
  }

  /** 按 id 更新，不存在时抛 404 */
  async update(id: number | string, dto: DeepPartial<T>): Promise<T> {
    await this.findOne(id)
    await this.repository.update(id, dto as never)
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
