import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm'

/**
 * 业务数据的「用户级行权限」（owner scope）
 *
 * 与 tenant 隔离是正交的两层：
 * - tenant 隔离（TenantContext + applyTenantScope）：A 租户看不到 B 租户；
 * - owner 权限（本工具）：同一租户内，普通成员只看自己创建的数据，管理员看全部。
 *
 * 为什么不另造一套权限模型：项目已有 sys_role.data_scope（1 全部 / 2 本部门及以下 /
 * 3 本部门 / 4 仅本人），这里直接复用它作为「业务数据可见范围」的判定，语义统一。
 *
 * 档位映射：
 * - 平台管理员 / data_scope=ALL(1) → 不过滤（看全部）
 * - data_scope=SELF_ONLY(4) → 只看自己创建（owner 列 = 当前用户 id）
 * - data_scope=部门档(2/3) → 自己创建 ∪ 被授权监管部门成员创建
 *   监管部门来自 sys_user_supervise_dept（ReBAC 轻量版），由 actor.superviseDeptIds 携带；
 *   没有监管授权时退化为「仅本人」——宁可少看，不可越权。
 *
 * 为什么业务表不加 dept_id：customer/order 用 createBy（sys_user.id），
 * 部门归属存在 sys_user_depart 多对多表里。这里用 EXISTS 子查询从 owner 反查其所属部门，
 * 不需要动业务表结构，也不影响历史数据。
 *
 * 注意：
 * 1. owner 列存的是 sys_user.id（32 位字符串），customer/order 用 createBy，
 *    历史数据 createBy 可能为空——空值在 SELF_ONLY 下将被过滤掉（看不到），符合"无主数据不算我的"。
 * 2. 平台视角（TenantContext=null，超管未指定租户）本工具不过滤，由 tenant 层决定可见范围。
 */
export interface OwnerScopeActor {
  id: string
  isPlatformAdmin?: number
  roles?: Array<{ dataScope?: number | null }> | null
  /** 该用户被授权监管的部门 id（**已含子孙，配置时展开**）；只有部门档(2/3)会用 */
  superviseDeptIds?: string[] | null
}

/** data_scope 数值（与 user.service 的 DATA_SCOPE 常量保持一致，避免 shared → modules 反向依赖） */
const DATA_SCOPE_ALL = 1
const DATA_SCOPE_DEPT_AND_CHILDREN = 2
const DATA_SCOPE_DEPT_ONLY = 3

/** 多角色取最小 data_scope：数值越小权限越大（与 user.service.applyDataScope 同口径） */
function minScope(actor: OwnerScopeActor): number {
  const roles = actor.roles ?? []
  if (!roles.length) return DATA_SCOPE_ALL
  return Math.min(...roles.map(role => role.dataScope ?? DATA_SCOPE_ALL))
}

/** 当前 actor 是否应受 owner 级收窄 */
export function needsOwnerScope(actor?: OwnerScopeActor | null): boolean {
  if (!actor) return false
  if (Number(actor.isPlatformAdmin ?? 0) === 1) return false
  return minScope(actor) > DATA_SCOPE_ALL
}

/**
 * 给业务表查询加 owner 级条件（就地修改 qb）
 *
 * @param qb         读查询 QueryBuilder（已由 createTenantQb 注入租户条件）
 * @param alias      主表别名
 * @param actor      req.user
 * @param ownerColumn  owner 字段的实体属性名（默认 createBy）
 */
export function applyOwnerScope<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  actor: OwnerScopeActor | null | undefined,
  ownerColumn = 'createBy'
): void {
  if (!needsOwnerScope(actor)) return
  const current = actor as OwnerScopeActor
  const scope = minScope(current)
  const deptIds = (current.superviseDeptIds ?? []).filter(Boolean)
  const isDeptScope = (scope === DATA_SCOPE_DEPT_AND_CHILDREN || scope === DATA_SCOPE_DEPT_ONLY) && deptIds.length > 0

  if (isDeptScope) {
    // 部门档 + 有监管授权：自己创建 ∪ 被监管部门成员创建。
    // 子查询从 owner（sys_user.id）反查 sys_user_depart，业务表无需 dept_id 列。
    // 去重靠 EXISTS 天然实现（同一用户属于多个监管部门也只出一行）。
    qb.andWhere(
      `(${alias}.${ownerColumn} = :__ownerScopeId OR EXISTS (SELECT 1 FROM \`sys_user_depart\` __osd WHERE __osd.\`user_id\` = ${alias}.${ownerColumn} AND __osd.\`dep_id\` IN (:...__ownerScopeDeptIds)))`,
      { __ownerScopeId: current.id, __ownerScopeDeptIds: deptIds }
    )
    return
  }

  qb.andWhere(`${alias}.${ownerColumn} = :__ownerScopeId`, { __ownerScopeId: current.id })
}
