import type { DataSource } from 'typeorm'

import { TenantContext } from './tenant.context'

/**
 * 通用「为每个租户执行」遍历（对应声明式 @TenantJob 的职责，任务框架用注册回调，
 * 装饰器形态不适用，收敛为这个工具函数）
 *
 * - 只遍历未删除租户；onlyActive=true（默认）时跳过已停用——停用租户通常不需要
 *   巡逻/提醒/巡检类任务，需要时显式传 false；
 * - 单个租户失败不中断整体：收集 {tenantId, ok, error}，任务自行决定怎么上报；
 * - fn 在 TenantContext.withTenant(tenantId) 内执行：租户上下文/审计归属都正确；
 * - 顺序执行不并行：遍历型任务通常是低频后台动作，串行最稳，也避免打爆连接池。
 */
export interface TenantRunResult<T> {
  tenantId: number
  ok: boolean
  value?: T
  error?: string
}

export async function runForAllTenants<T = void>(
  dataSource: DataSource,
  fn: (tenantId: number) => Promise<T>,
  options?: { onlyActive?: boolean }
): Promise<Array<TenantRunResult<T>>> {
  const onlyActive = options?.onlyActive ?? true
  const rows = await dataSource.query<Array<{ id: number | string }>>(
    `SELECT id FROM sys_tenant WHERE del_flag = 0${onlyActive ? ' AND status = 0' : ''} ORDER BY id ASC`
  )
  const results: Array<TenantRunResult<T>> = []
  for (const row of rows) {
    const tenantId = Number(row.id)
    if (!(tenantId > 0)) continue
    try {
      const value = await TenantContext.withTenant(tenantId, () => fn(tenantId))
      results.push({ tenantId, ok: true, value })
    } catch (error) {
      results.push({ tenantId, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}
