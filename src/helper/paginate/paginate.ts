import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm'

import { Pagination } from './pagination'

export interface PaginateOptions {
  /** 页码，从 1 开始 */
  page?: number
  /** 每页条数 */
  pageSize?: number
  /**
   * 是否统计总数（默认 true）
   *
   * 传 false 时不发 `SELECT COUNT(*)`，改为「多取 1 条」判断还有没有下一页，
   * 返回的 total / pages 都是 -1。千万行表上的 COUNT 要走全索引扫描（实测 17.8 秒），
   * 而列表页往往只需要知道「能不能翻下一页」。
   */
  count?: boolean
}

/**
 * 基于 QueryBuilder 的通用分页执行器
 * 用法：await paginate(qb, { page: 1, pageSize: 10 })
 */
export async function paginate<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, options: PaginateOptions = {}): Promise<Pagination<T>> {
  const page = Math.max(options.page ?? 1, 1)
  const pageSize = Math.max(options.pageSize ?? 10, 1)

  // 不统计总数：多取 1 条，够判断有没有下一页就停
  if (options.count === false) {
    const rows = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize + 1)
      .getMany()
    return new Pagination(rows.slice(0, pageSize), -1, page, pageSize, rows.length > pageSize)
  }

  const [records, total] = await qb
    .skip((page - 1) * pageSize)
    .take(pageSize)
    .getManyAndCount()

  return new Pagination(records, total, page, pageSize)
}
