import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm'

/**
 * 列表排序参数
 *
 * 只接受字段名与方向，**不接受任意列名直拼**：
 * 每个调用方提供一张白名单（前端列 id → 数据库列名），命不中就当没传，
 * 落到该列表自己的默认排序上。这样前端点表头排序不会变成 SQL 注入面，
 * 也不会因为列改名把接口打成 500。
 */
export interface SortQuery {
  sortBy?: string
  sortOrder?: string
}

/**
 * 把排序参数应用到 QueryBuilder
 *
 * @param qb       已有的 QueryBuilder（通常已带默认 orderBy）
 * @param alias    主表别名，如 'user'
 * @param query    来自 DTO 的排序参数
 * @param allow    白名单：{ 前端列 id: 数据库列名 }，列名不带别名
 * @returns        是否真的改写了排序（调用方可据此决定要不要清掉默认排序）
 *
 * 命中白名单时先 `orderBy` 覆写默认排序，再补 id 兜底 —— 排序列有重复值时
 * （比如按状态排），没有唯一键兜底 MySQL 的 LIMIT/OFFSET 结果会重复或漏行。
 */
export function applySort<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, alias: string, query: SortQuery, allow: Record<string, string>): boolean {
  const column = query.sortBy ? allow[query.sortBy] : undefined
  if (!column) return false
  const direction = query.sortOrder?.toLowerCase() === 'desc' ? 'DESC' : 'ASC'
  qb.orderBy(`${alias}.${column}`, direction)
  // 排序列本身是主键时不需要兜底
  if (column !== 'id') {
    qb.addOrderBy(`${alias}.id`, direction)
  }
  return true
}

/** 排序方向归一化（DTO 只收两个值，这里再兜一层，防止大小写/空串写进 SQL） */
export function normalizeSortOrder(value?: string): 'asc' | 'desc' | undefined {
  if (!value) return undefined
  const lower = value.toLowerCase()
  return lower === 'asc' || lower === 'desc' ? lower : undefined
}
