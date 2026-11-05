/**
 * 内置超级管理员角色编码
 *
 * 权限模型（有意设计，不是漏判）：
 * 超管**不读** sys_role_permission，直接拥有全部菜单与按钮权限，
 * 目的是避免管理员误删自己的授权把自己锁在门外。
 * 代价：给超管角色分配权限不产生任何效果，因此授权接口对超管角色一律拒绝写入。
 *
 * 判定必须全项目共用这一处：之前 auth.service 认 admin/superadmin、PermsGuard 只认 admin、
 * RolesGuard 一个不认，导致建 superadmin 角色时会出现「前端全开、后端 403」的不一致。
 */
export const SUPER_ROLE_CODES = ['admin', 'superadmin'] as const

/** 角色编码是否是内置超管 */
export function isSuperRole(roleCode?: string | null): boolean {
  return !!roleCode && (SUPER_ROLE_CODES as readonly string[]).includes(roleCode)
}

/** 用户持有的多个角色里是否含超管（入参兼容 req.user.roles 与权限汇总里的角色数组） */
export function hasSuperRole(roles?: Array<{ roleCode?: string | null }> | null): boolean {
  return (roles ?? []).some(role => isSuperRole(role.roleCode))
}
