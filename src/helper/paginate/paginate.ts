import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm'

import { Pagination } from './pagination'

export interface PaginateOptions {
  /** 页码，从 1 开始 */
  page?: number
  /** 每页条数 */
  pageSize?: number
}

/**
 * 基于 QueryBuilder 的通用分页执行器
 * 用法：await paginate(qb, { page: 1, pageSize: 10 })
 */
export async function paginate<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, options: PaginateOptions = {}): Promise<Pagination<T>> {
  const page = Math.max(options.page ?? 1, 1)
  const pageSize = Math.max(options.pageSize ?? 10, 1)

  const [items, total] = await qb
    .skip((page - 1) * pageSize)
    .take(pageSize)
    .getManyAndCount()

  return new Pagination(items, total, page, pageSize)
}
