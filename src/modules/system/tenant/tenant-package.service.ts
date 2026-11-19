import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'

import { AuthUserCacheService } from '../../../shared/auth-cache/auth-user-cache.service'
import { PermissionCacheService } from '../../../shared/permission-cache/permission-cache.service'
import { randomId32 } from '../../../utils/password.util'
import { MenuEntity } from '../../menu/entities/menu.entity'
import { buildMenuTree, type MenuTreeItem } from '../../menu/menu.service'
import { TenantMenuEntity } from './entities/tenant-menu.entity'

/** 单条 INSERT 拼多少组值（与 provision 的 GRANT_CHUNK 同量级，避免超长 SQL） */
const INSERT_CHUNK = 200

/** 租户套餐详情：已开通菜单 id 集合 + 可勾选的租户级菜单树（平台级菜单不在树里） */
export interface TenantPackageDetail {
  menuIds: string[]
  tree: MenuTreeItem[]
}

/**
 * 租户功能套餐（sys_tenant_menu）读写
 *
 * 套餐 = 该租户可授权/可见的租户级菜单上限，消费方有两处（都要取交集，缺一不可）：
 * 1. RoleService.assignMenus —— 授权写入时校验 menuIds ⊆ 套餐
 * 2. auth.getPermissionInfo —— 登录菜单树/权限码汇总时按套餐过滤
 *
 * 平台管理员通过 PUT /v1/tenants/:id/menus 全量重设套餐（权限点 system:tenant:edit，scope=platform）。
 * 收窄套餐**不会**自动回收角色已授权的菜单（sys_role_permission 不动），
 * 交集在读取端生效：超出套餐的授权不显示、权限码不下发。
 */
@Injectable()
export class TenantPackageService {
  constructor(
    @InjectRepository(TenantMenuEntity)
    private readonly packageRepository: Repository<TenantMenuEntity>,
    @InjectRepository(MenuEntity)
    private readonly menuRepository: Repository<MenuEntity>,
    private readonly authUserCache: AuthUserCacheService,
    private readonly permissionCache: PermissionCacheService
  ) {}

  /** 套餐菜单 id 集合（授权校验/菜单树过滤共用；表无行 = 空套餐 = 无可授权菜单） */
  async getPackageSet(tenantId: number): Promise<Set<string>> {
    const rows = await this.packageRepository.query<Array<{ pid: string }>>('SELECT permission_id AS pid FROM sys_tenant_menu WHERE tenant_id = ?', [tenantId])
    return new Set(rows.map(row => row.pid))
  }

  /** 套餐详情（租户管理页「功能套餐」弹窗回显用）：id 集合 + 租户级菜单树 */
  async getPackageDetail(tenantId: number): Promise<TenantPackageDetail> {
    const menuIds = [...(await this.getPackageSet(tenantId))]
    const treeMenus = await this.menuRepository.find({ where: { scope: 'tenant', delFlag: 0 }, order: { sortNo: 'ASC' } })
    return { menuIds, tree: buildMenuTree(treeMenus, null) }
  }

  /**
   * 全量重设套餐（多退少补）
   *
   * - 只接受真实存在、未删除的**租户级**菜单；按钮节点（menuType=2）也允许进套餐
   * - 幂等：同一组 id 重复提交结果一致
   * - 调用方需先确认租户存在（控制器 findOne），这里只管写
   */
  async setPackage(tenantId: number, menuIds: string[]): Promise<{ total: number }> {
    const ids = [...new Set(menuIds.filter(Boolean))]
    if (ids.length) {
      const menus = await this.menuRepository.find({ where: { id: In(ids), delFlag: 0 } })
      if (menus.length !== ids.length) {
        throw new NotFoundException('存在无效的菜单 ID')
      }
      const platformNode = menus.find(menu => menu.scope === 'platform')
      if (platformNode) {
        throw new NotFoundException(`「${platformNode.name}」是平台级菜单，不能进入租户套餐`)
      }
    }

    await this.packageRepository.manager.transaction(async manager => {
      await manager.query('DELETE FROM sys_tenant_menu WHERE tenant_id = ?', [tenantId])
      for (let index = 0; index < ids.length; index += INSERT_CHUNK) {
        const chunk = ids.slice(index, index + INSERT_CHUNK)
        const placeholders = chunk.map(() => '(?, ?, ?, NOW())').join(', ')
        await manager.query(
          `INSERT INTO sys_tenant_menu (id, tenant_id, permission_id, create_time) VALUES ${placeholders}`,
          chunk.flatMap(id => [randomId32(), tenantId, id])
        )
      }
    })

    // 菜单树快照随套餐变化：登录用户缓存里的 roles/permissions/menus 全部重算；
    // 接口侧 PermsGuard 用的套餐权限集合也要立即失效（Redis 缓存跨实例生效）
    this.authUserCache.invalidateAll()
    await this.permissionCache.invalidateTenant(tenantId)
    return { total: ids.length }
  }
}
