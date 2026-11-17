/**
 * 新租户默认角色模板
 *
 * 解决什么问题：菜单（sys_permission）是平台共享的，角色（sys_role）是租户级的。
 * 新建租户时如果只插一行 sys_tenant，该租户就是**空壳** —— 进去没有任何角色，
 * 也拿不到任何按钮权限（PermsGuard 只看 sys_role_permission，内置角色不享受绕过），
 * 管理员得手工照着平台租户一个个勾菜单，漏一个按钮就是 403。
 *
 * 因此建租户时按本模板自动落三套角色：
 *  - admin  管理员：本租户全部租户级权限，`is_builtin=1`（受「不可删/不可停用/不可改编码」保护）
 *  - editor 编辑者：可增删改业务数据，但不给「删除」这类破坏性权限
 *  - viewer 访客  ：只读（列表/详情/导出）
 *
 * 三条硬规则：
 *  1. **只取 `scope='tenant'` 的菜单**。platform 级的（租户管理/菜单管理/运维监控）属于平台管理员，
 *     写进租户角色的关联表只会产生「看起来有、点进去 403」的脏数据（RoleService.assignMenus 同样拒绝）。
 *  2. **判定看的是权限码不是菜单类型**：目录/页面节点通常没有 perms，必须给（否则侧边栏没菜单）；
 *     有 perms 的节点才按后缀区分读写。
 *  3. 只读/编辑者的后缀白名单是「未列出即不给」，不是黑名单 —— 将来新增一个 `:approve` 这类权限码，
 *     默认只进管理员角色，避免误授权。
 */

/** 角色权限档位：all 全部 / write 可写不可删 / read 只读 */
export type TenantRoleLevel = 'all' | 'write' | 'read'

export interface TenantRoleTemplate {
  roleCode: string
  roleName: string
  description: string
  /** 数据范围：1 全部 / 2 本部门及以下 / 3 本部门 / 4 仅本人 */
  dataScope: number
  /** 1 = 内置角色（不可删除/停用/改编码，同时也不允许走 assignMenus 改授权） */
  isBuiltin: number
  level: TenantRoleLevel
}

/**
 * 只读可用的权限码后缀（白名单）
 *
 * export / download 是「把数据拉走」，对只读角色算合理能力；
 * list 是列表接口的前置权限，没有它侧边栏点进去就是 403。
 */
const READ_SUFFIXES = new Set(['list', 'query', 'detail', 'export', 'download'])

/**
 * 即使给「编辑者」也绝不外放的破坏性权限后缀
 *
 * 删除是业务数据不可逆操作；重置密码/恢复备份会直接影响他人账号与历史数据。
 * 需要这些能力的租户请自行建「管理员」级别的自定义角色。
 */
const DANGEROUS_SUFFIXES = new Set(['delete', 'batch-delete', 'clean', 'reset-password', 'restore'])

/** 新租户默认角色（顺序即创建顺序，列表里 admin 排最前） */
export const TENANT_ROLE_TEMPLATES: TenantRoleTemplate[] = [
  {
    roleCode: 'admin',
    roleName: '管理员',
    description: '租户管理员，拥有本租户全部功能权限',
    dataScope: 1,
    isBuiltin: 1,
    level: 'all'
  },
  {
    roleCode: 'editor',
    roleName: '编辑者',
    description: '可新增与修改业务数据，不含删除、重置密码等破坏性权限',
    dataScope: 1,
    isBuiltin: 0,
    level: 'write'
  },
  {
    roleCode: 'viewer',
    roleName: '访客',
    description: '只读：可查看列表与详情、导出数据，不能修改任何内容',
    dataScope: 1,
    isBuiltin: 0,
    level: 'read'
  }
]

/** 取权限码的最后一段：`system:user:add` → `add`；无冒号则整串 */
export function permsSuffix(perms?: string | null): string {
  const value = (perms ?? '').trim()
  if (!value) return ''
  const index = value.lastIndexOf(':')
  return index >= 0 ? value.slice(index + 1) : value
}

/**
 * 该档位是否应授予这个权限节点
 *
 * 无权限码的节点（目录/页面）一律授予：它们只决定「页面可不可见」，
 * 真正的接口校验落在按钮节点的权限码上。
 */
export function acceptsByLevel(level: TenantRoleLevel, perms?: string | null): boolean {
  if (level === 'all') return true
  const suffix = permsSuffix(perms)
  if (!suffix) return true
  if (level === 'read') return READ_SUFFIXES.has(suffix)
  return !DANGEROUS_SUFFIXES.has(suffix)
}

/**
 * 只读/编辑档一律不授予的模块（连同页面节点、子菜单、按钮整棵子树）
 *
 * 为什么需要「模块级排除」，只靠后缀白名单不够：用户管理的按钮恰好叫 `list` / `export`，
 * 后缀白名单把它们当成「只读能力」放给了访客，结果访客能翻遍全租户的手机号、邮箱并整表导出。
 * 成员管理是管理员职责，不因为「只读」就该给 —— 只读只该作用于业务数据，不该作用于「谁能看到人」。
 *
 * 匹配规则：权限码前缀命中，或菜单 url 精确命中（含子路径）。命中后向下递归收集所有子孙，
 * 所以页面节点即使哪天去掉了 perms，也靠 url 兜住 —— 否则侧边栏还留着入口，点进去 403。
 *
 * 选人控件不受影响：`GET /v1/users/lookup` 与 `/v1/users/me` 不挂任何 @Perms，登录即可用。
 */
export const TENANT_RESTRICTED_MODULES: Array<{ urlPrefix: string; permsPrefix?: string }> = [
  { urlPrefix: '/system/users', permsPrefix: 'system:user' },
  // 菜单是全平台共享的配置：编辑者拿到 `system:menu:update` 就能改所有租户的侧边栏，必须拦在模板层
  { urlPrefix: '/system/menu', permsPrefix: 'system:menu' },
  // 角色权限页是「谁能干什么」的配置表，租户内也只该由管理员看
  { urlPrefix: '/system/role', permsPrefix: 'system:role' }
]

/** 租户级菜单节点（本文件只关心定位子树需要的字段） */
export interface TenantMenuNode {
  id: string
  parentId: string | null
  perms: string | null
  url: string | null
}

/**
 * 计算某档位必须排除的菜单节点 id 集合
 *
 * `all` 档返回空集（租户管理员本来就要管成员）；read/write 档按 TENANT_RESTRICTED_MODULES 排除。
 * 传整棵菜单树进来算一次即可，三个模板角色共用，避免每档重复遍历。
 */
export function restrictedMenuIds(level: TenantRoleLevel, nodes: TenantMenuNode[]): Set<string> {
  const blocked = new Set<string>()
  if (level === 'all' || !TENANT_RESTRICTED_MODULES.length) return blocked

  const childrenOf = new Map<string, string[]>()
  for (const node of nodes) {
    if (!node.parentId) continue
    const siblings = childrenOf.get(node.parentId) ?? []
    siblings.push(node.id)
    childrenOf.set(node.parentId, siblings)
  }

  const isRestricted = (node: TenantMenuNode): boolean =>
    TENANT_RESTRICTED_MODULES.some(module => {
      const url = (node.url ?? '').trim()
      const byUrl = url === module.urlPrefix || url.startsWith(`${module.urlPrefix}/`)
      const perms = (node.perms ?? '').trim()
      const byPerms = !!module.permsPrefix && perms.startsWith(module.permsPrefix)
      return byUrl || byPerms
    })

  const queue = nodes.filter(isRestricted).map(node => node.id)
  while (queue.length) {
    const id = queue.pop() as string
    if (blocked.has(id)) continue
    blocked.add(id)
    for (const child of childrenOf.get(id) ?? []) queue.push(child)
  }
  return blocked
}
