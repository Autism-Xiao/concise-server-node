/**
 * 内置管理员角色编码
 *
 * 用途已经**收窄**（多租户改造后）：
 * 1. 保留编码：不允许再创建/改名为这些编码（`RoleService.createRole` / `updateRole`）
 * 2. 判定「内置角色」的兜底工具（正式保护判断请用 `sys_role.is_builtin`，见 role.entity.ts 注释）
 * 3. 水印模块判断「管理员」身份（`WatermarkService.updateMine`）
 *
 * ⚠️ **不要**再用它判断「平台管理员 / 超管」：
 * sys_role 是**租户级**表，任何被授予 admin 角色的租户用户都会被误判成平台超管
 * （可切任意租户、不带 X-Tenant-Id 时全库不过滤）。平台管理员的唯一依据是
 * `sys_user.is_platform_admin`（见 `TenantAccessService.loadMembership`）。
 * PermsGuard / RolesGuard / AuthService.getPermissions 都已改成读这个字段。
 */
export const SUPER_ROLE_CODES = ['admin', 'superadmin'] as const

/** 角色编码是否是保留编码（内置管理员） */
export function isSuperRole(roleCode?: string | null): boolean {
  return !!roleCode && (SUPER_ROLE_CODES as readonly string[]).includes(roleCode)
}

/**
 * 用户持有的多个角色里是否含内置管理员角色
 *
 * 语义 = 「该账号是某个租户的管理员」，**不是**「平台超管」。
 * 需要跨租户能力时请判 `user.isPlatformAdmin`。
 */
export function hasSuperRole(roles?: Array<{ roleCode?: string | null }> | null): boolean {
  return (roles ?? []).some(role => isSuperRole(role.roleCode))
}
