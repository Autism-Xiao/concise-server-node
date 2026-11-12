import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm'

import { TenantContext } from './tenant.context'

/** 平台共享数据的租户 ID（tenant_id = 0 对所有租户可见） */
export const SHARED_TENANT_ID = 0

export interface TenantCondition {
  clause: string
  params: Record<string, number>
}

/**
 * 生成租户过滤条件
 *
 * - `null`（上下文未设置 / 超管平台视角）→ 不加条件
 * - `0`  → 只看平台共享数据
 * - `>0` → 该租户 + 平台共享数据（`tenant_id = 0` 是内置字典这类公共数据）
 *
 * 需要 `alias` 是 QueryBuilder 的主表别名。
 */
export function tenantCondition(alias: string): TenantCondition | null {
  const tenantId = TenantContext.filterTenantId()
  if (tenantId === null) return null
  if (tenantId === SHARED_TENANT_ID) {
    return { clause: `${alias}.tenant_id = ${SHARED_TENANT_ID}`, params: {} }
  }
  return {
    clause: `(${alias}.tenant_id = :__tenantId OR ${alias}.tenant_id = ${SHARED_TENANT_ID})`,
    params: { __tenantId: tenantId }
  }
}

/** 给查询加上租户条件（就地修改并返回同一个 qb，方便链式调用） */
export function applyTenantScope<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, alias: string): SelectQueryBuilder<T> {
  const condition = tenantCondition(alias)
  if (condition) {
    qb.andWhere(condition.clause, condition.params)
  }
  return qb
}

/**
 * 不带别名的租户条件（UPDATE / DELETE 的 QueryBuilder 没有别名，列名直接写 tenant_id）
 * 返回 null 表示不过滤。
 */
export function tenantRawCondition(column = 'tenant_id'): TenantCondition | null {
  const tenantId = TenantContext.filterTenantId()
  if (tenantId === null) return null
  if (tenantId === SHARED_TENANT_ID) {
    return { clause: `${column} = ${SHARED_TENANT_ID}`, params: {} }
  }
  return {
    clause: `(${column} = :__tenantId OR ${column} = ${SHARED_TENANT_ID})`,
    params: { __tenantId: tenantId }
  }
}
