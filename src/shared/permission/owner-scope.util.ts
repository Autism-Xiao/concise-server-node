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
 * 档位映射（业务实体没有 dept_id 列，部门档无法精确表达）：
 * - 平台管理员 / data_scope=ALL(1) → 不过滤（看全部）
 * - 其余（2/3/4）→ 按 owner 列 = 当前用户 id 过滤
 *   部门档(2/3)保守退化为「仅本人」而非放开——宁可少看，不可越权看别人的业务数据。
 *   若将来业务表加了 dept_id，可在此扩展为部门集合过滤。
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
}

/** data_scope 数值（与 user.service 的 DATA_SCOPE 常量保持一致，避免 shared → modules 反向依赖） */
const DATA_SCOPE_ALL = 1

/** 当前 actor 是否应受 owner 级收窄 */
export function needsOwnerScope(actor?: OwnerScopeActor | null): boolean {
  if (!actor) return false
  if (Number(actor.isPlatformAdmin ?? 0) === 1) return false
  const roles = actor.roles ?? []
  if (!roles.length) return false
  // 多角色取最小 data_scope（与 user.service.applyDataScope 同口径）
  const scope = Math.min(...roles.map(role => role.dataScope ?? DATA_SCOPE_ALL))
  return scope > DATA_SCOPE_ALL
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
  qb.andWhere(`${alias}.${ownerColumn} = :__ownerScopeId`, { __ownerScopeId: actor!.id })
}
