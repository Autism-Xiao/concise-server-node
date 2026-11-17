import { Injectable, Logger } from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'

import { AuthUserCacheService } from '../../../shared/auth-cache/auth-user-cache.service'
import { PermissionCacheService } from '../../../shared/permission-cache/permission-cache.service'
import { randomId32 } from '../../../utils/password.util'
import { acceptsByLevel, pruneEmptyDirs, restrictedMenuIds, TENANT_ROLE_TEMPLATES, type TenantMenuNode, type TenantRoleTemplate } from './tenant-role-template'

/** 单条 INSERT 拼多少组值：权限多时避免超长 SQL 被 MySQL 截断 */
const GRANT_CHUNK = 200

export interface TenantProvisionRoleResult {
  roleCode: string
  roleId: string
  /** 本次新建了角色 */
  created: boolean
  /** 本次新增的授权条数（幂等重跑时为 0） */
  added: number
  /** 角色应有的授权总数 */
  total: number
}

export interface TenantProvisionResult {
  tenantId: number
  roles: TenantProvisionRoleResult[]
  /** 本租户的套餐菜单总数（sys_tenant_menu 行数口径：开通时角色应得菜单的并集） */
  packageTotal: number
  /** 本次套餐新增的菜单数（幂等重跑时为 0；>0 时调用方必须失效鉴权用户缓存） */
  packageAdded: number
}

export interface TenantProvisionAllResult {
  tenants: number
  createdRoles: number
  addedGrants: number
  details: TenantProvisionResult[]
}

/**
 * 租户初始化：给租户建一套默认角色并授好权限
 *
 * 为什么放在 service 而不是复用 RoleService：RoleService.assignMenus 对 `is_builtin=1` 的角色
 * 是**直接拒绝**的（内置角色由平台管理员整体掌控，不允许租户自己改授权）。而建租户恰恰要
 * 给内置 admin 角色写入初始授权，所以这里绕开业务服务，直接操作关联表。
 *
 * 幂等：角色按 `(tenant_id, role_code)` 查，授权按差集补。重复调用不会重复插入，
 * 也能用来「平台新增了租户级菜单后，把已有租户的角色补齐」。
 */
@Injectable()
export class TenantProvisionService {
  private readonly logger = new Logger(TenantProvisionService.name)

  constructor(
    private readonly dataSource: DataSource,
    private readonly permissionCache: PermissionCacheService,
    private readonly authUserCache: AuthUserCacheService
  ) {}

  /** 初始化单个租户（自带事务） */
  async provision(tenantId: number, operator?: string): Promise<TenantProvisionResult> {
    const result = await this.dataSource.transaction(manager => this.provisionIn(manager, tenantId, operator))
    await this.invalidateCaches([result])
    return result
  }

  /**
   * 初始化全部未删除租户（存量空壳补建 / 新菜单上线后批量补齐）
   *
   * 逐租户一个事务：某个租户失败（例如角色编码被脏数据占用）不会拖垮整批。
   */
  async provisionAll(operator?: string): Promise<TenantProvisionAllResult> {
    const rows = await this.dataSource.query<Array<{ id: number | string }>>('SELECT id FROM sys_tenant WHERE del_flag = 0 ORDER BY id')
    // 菜单只查一次：所有租户共用同一棵租户级菜单树
    const menus = await this.loadTenantMenus(this.dataSource.manager)
    const details: TenantProvisionResult[] = []

    for (const row of rows) {
      const tenantId = Number(row.id)
      try {
        details.push(await this.dataSource.transaction(manager => this.provisionIn(manager, tenantId, operator, menus)))
      } catch (error) {
        // 单个租户失败不中断：返回结果里少一条，日志留原因
        this.logger.warn(`租户 #${tenantId} 初始化失败：${(error as Error)?.message ?? error}`)
      }
    }

    await this.invalidateCaches(details)
    return {
      tenants: details.length,
      createdRoles: details.reduce((sum, item) => sum + item.roles.filter(role => role.created).length, 0),
      addedGrants: details.reduce((sum, item) => sum + item.roles.reduce((acc, role) => acc + role.added, 0), 0),
      details
    }
  }

  /**
   * 在既有事务内初始化租户（创建租户时调用，保证「建租户 + 建角色」同生共死）
   *
   * @param menus 预先查好的租户级菜单，批量场景下复用，避免 N 次全表查询；不传则现查
   */
  async provisionIn(manager: EntityManager, tenantId: number, operator?: string, menus?: TenantMenuNode[]): Promise<TenantProvisionResult> {
    const menuRows = menus ?? (await this.loadTenantMenus(manager))
    const existingRows = await manager.query<Array<{ id: string; roleCode: string }>>('SELECT id, role_code AS roleCode FROM sys_role WHERE tenant_id = ?', [
      tenantId
    ])
    const existing = new Map(existingRows.map(row => [row.roleCode, row.id]))
    const roles: TenantProvisionRoleResult[] = []
    // 排除集合按档位算一次：三个模板角色共用同一棵树
    const blockedByLevel = new Map<string, Set<string>>()
    // 套餐 = 三个模板角色应得菜单的并集（admin 档是超集，实际等于 admin 的 targetIds）；
    // 只增不减：INSERT IGNORE，平台新增租户级菜单后重跑 provision 会自动扩容
    const packageIds = new Set<string>()
    let packageAddedTotal = 0

    for (const template of TENANT_ROLE_TEMPLATES) {
      let roleId = existing.get(template.roleCode)
      let created = false
      if (!roleId) {
        roleId = randomId32()
        await this.insertRole(manager, roleId, tenantId, template, operator)
        created = true
      }
      let blocked = blockedByLevel.get(template.level)
      if (!blocked) {
        blocked = restrictedMenuIds(template.level, menuRows)
        blockedByLevel.set(template.level, blocked)
      }
      // 两轮过滤：先按档位排除模块，再剔除「子节点全被排掉」的目录（否则侧边栏留一个点进去 404 的分组）
      const accepted = menuRows.filter(menu => !blocked.has(menu.id) && acceptsByLevel(template.level, menu.perms))
      const targetIds = [...pruneEmptyDirs(new Set(accepted.map(menu => menu.id)), menuRows)]
      for (const id of targetIds) packageIds.add(id)
      const added = await this.grant(manager, roleId, targetIds)
      roles.push({ roleCode: template.roleCode, roleId, created, added, total: targetIds.length })
    }

    packageAddedTotal += await this.upsertPackage(manager, tenantId, packageIds)

    return { tenantId, roles, packageTotal: packageIds.size, packageAdded: packageAddedTotal }
  }

  /**
   * 套餐只增不减：与既有 sys_tenant_menu 行取并集后落库
   *
   * 注意不能全量覆盖——平台管理员可能已经收窄过套餐（PUT /v1/tenants/:id/menus），
   * 重跑 provision（补角色/补新菜单）不该把套餐偷偷放大回全量。
   */
  private async upsertPackage(manager: EntityManager, tenantId: number, menuIds: Set<string>): Promise<number> {
    const ownedRows = await manager.query<Array<{ pid: string }>>('SELECT permission_id AS pid FROM sys_tenant_menu WHERE tenant_id = ?', [tenantId])
    const owned = new Set(ownedRows.map(row => row.pid))
    const toAdd = [...menuIds].filter(id => !owned.has(id))
    if (!toAdd.length) return 0

    for (let index = 0; index < toAdd.length; index += GRANT_CHUNK) {
      const chunk = toAdd.slice(index, index + GRANT_CHUNK)
      const placeholders = chunk.map(() => '(?, ?, ?, NOW())').join(', ')
      await manager.query(
        `INSERT IGNORE INTO sys_tenant_menu (id, tenant_id, permission_id, create_time) VALUES ${placeholders}`,
        chunk.flatMap(id => [randomId32(), tenantId, id])
      )
    }
    return toAdd.length
  }

  /** 租户级有效菜单（platform 级的绝不能进租户角色，见 tenant-role-template.ts 注释） */
  private async loadTenantMenus(manager: EntityManager): Promise<TenantMenuNode[]> {
    const rows = await manager.query<Array<{ id: string; parentId: string | null; perms: string | null; url: string | null }>>(
      `SELECT id, parent_id AS parentId, perms, url FROM sys_permission
        WHERE del_flag = 0 AND status = '1' AND scope = 'tenant'
        ORDER BY sort_no, id`
    )
    // parent_id 可能是空串（历史数据），统一成 null，否则会被当成一个「叫空串的父节点」
    return rows.map(row => ({ id: row.id, parentId: row.parentId ? String(row.parentId) : null, perms: row.perms, url: row.url }))
  }

  private async insertRole(manager: EntityManager, roleId: string, tenantId: number, template: TenantRoleTemplate, operator?: string): Promise<void> {
    await manager.query(
      `INSERT INTO sys_role (id, role_name, role_code, data_scope, description, status, tenant_id, is_builtin, create_by, create_time)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, NOW())`,
      [roleId, template.roleName, template.roleCode, template.dataScope, template.description, tenantId, template.isBuiltin, operator ?? null]
    )
  }

  /** 差集补授权，返回新增条数（`INSERT IGNORE` 兜住并发重复插入） */
  private async grant(manager: EntityManager, roleId: string, menuIds: string[]): Promise<number> {
    if (!menuIds.length) return 0
    const ownedRows = await manager.query<Array<{ pid: string }>>('SELECT permission_id AS pid FROM sys_role_permission WHERE role_id = ?', [roleId])
    const owned = new Set(ownedRows.map(row => row.pid))
    const toAdd = menuIds.filter(id => !owned.has(id))
    if (!toAdd.length) return 0

    for (let index = 0; index < toAdd.length; index += GRANT_CHUNK) {
      const chunk = toAdd.slice(index, index + GRANT_CHUNK)
      const placeholders = chunk.map(() => '(?, ?, NOW())').join(', ')
      await manager.query(
        `INSERT IGNORE INTO sys_role_permission (role_id, permission_id, operate_date) VALUES ${placeholders}`,
        chunk.flatMap(id => [roleId, id])
      )
    }
    return toAdd.length
  }

  /** 授权变了：角色权限集合缓存 + 鉴权用户缓存（roles/permissions 快照）都要失效 */
  private async invalidateCaches(results: TenantProvisionResult[]): Promise<void> {
    let changed = false
    for (const result of results) {
      for (const role of result.roles) {
        if (!role.created && role.added === 0) continue
        await this.permissionCache.invalidateRole(role.roleId)
        changed = true
      }
      // 套餐扩容会改变登录菜单树的交集结果，鉴权用户缓存同样要失效
      if (result.packageAdded > 0) {
        changed = true
      }
    }
    if (changed) {
      this.authUserCache.invalidateAll()
    }
  }
}
