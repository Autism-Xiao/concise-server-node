import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull, Repository, type DeepPartial } from 'typeorm'

import { BizErrorCode } from '../../common/enums/biz-error-code.enum'
import { BizException } from '../../common/exceptions/biz.exception'
import { BaseService } from '../../helper/crud/base.service'
import { PermissionCacheService } from '../../shared/permission-cache/permission-cache.service'
import { MenuEntity } from './entities/menu.entity'
import type { PermNodeDto } from './dto/perm-node.dto'

export interface MenuTreeItem extends MenuEntity {
  children: MenuTreeItem[]
}

/** 按钮权限节点全量替换的结果（供前端提示与冒烟断言） */
export interface ReplacePermNodesResult {
  added: string[]
  removed: string[]
  kept: string[]
}

/** 顶级菜单的 parent_id 约定（JeecgBoot 用 null 或空串） */
function isRootParent(parentId?: string | null): boolean {
  return parentId === null || parentId === undefined || parentId === ''
}

@Injectable()
export class MenuService extends BaseService<MenuEntity> {
  constructor(
    @InjectRepository(MenuEntity)
    repository: Repository<MenuEntity>,
    private readonly permissionCache: PermissionCacheService
  ) {
    super(repository, '菜单')
  }

  /** 创建：补 JeecgBoot 默认值（未删除、有效、是路由、不隐藏） */
  async create(dto: DeepPartial<MenuEntity>): Promise<MenuEntity> {
    if (dto.parentId) {
      await this.assertParentExists(dto.parentId)
    }
    const menu = await super.create({
      ...dto,
      delFlag: dto.delFlag ?? 0,
      status: dto.status ?? '1',
      isRoute: dto.isRoute ?? 1,
      hidden: dto.hidden ?? 0,
      permsType: dto.permsType ?? '1',
      sortNo: dto.sortNo ?? 0,
      createTime: new Date()
    })
    // 菜单即权限点：新增一个带 permission 的按钮会改变所有角色的可用权限集合
    await this.permissionCache.invalidateAll()
    return menu
  }

  /** 更新：维护更新时间；换父级时校验父级存在且不形成环 */
  async update(id: string, dto: DeepPartial<MenuEntity>): Promise<MenuEntity> {
    if (dto.parentId) {
      await this.assertNoCycle(id, dto.parentId)
    }
    const menu = await super.update(id, { ...dto, updateTime: new Date() })
    // 可能改了 permission / status / del_flag，所有角色的权限集合都要重算
    await this.permissionCache.invalidateAll()
    return menu
  }

  /** 删除：软删除（对齐 sys_permission.del_flag）；存在未删除子级时拒绝，避免挂空父级 */
  async delete(id: string): Promise<void> {
    const children = await this.repository.count({ where: { parentId: id, delFlag: 0 } })
    if (children > 0) {
      throw new BizException(BizErrorCode.BUSINESS_ERROR, '该菜单存在子菜单，请先删除其子菜单')
    }
    const menu = await this.repository.findOne({ where: { id, delFlag: 0 } })
    if (!menu) {
      throw new BizException(BizErrorCode.NOT_FOUND, '菜单不存在')
    }
    await this.repository.update(id, { delFlag: 1, updateTime: new Date() })
    // 软删的菜单不再算权限（守卫 SQL 有 del_flag = 0 条件），缓存要跟着清
    await this.permissionCache.invalidateAll()
  }

  /** 全量菜单（按 sort_no 升序，排除已删除） */
  async listAll(): Promise<MenuEntity[]> {
    return this.repository.find({ where: { delFlag: 0 }, order: { sortNo: 'ASC', id: 'ASC' } })
  }

  /**
   * 全量替换某菜单下的按钮权限节点（菜单管理「权限节点」穿梭框的保存动作）
   *
   * 语义：以提交的 nodes 为准 ——
   * - 新 perms → 新建按钮子级（menuType=2）
   * - 既有 perms 未出现在提交里 → 软删除（del_flag=1，不动 role_menu 授权行；
   *   权限计算 / PermsGuard / getPermissions 都按 del_flag=0 过滤，删完即失效）
   * - 两者交集 → 原样保留（名称以提交为准顺带更新）
   *
   * 安全：事务包裹（多步写）；同 payload 内 perms 先去重；按钮下不能再挂按钮。
   */
  async replacePermNodes(id: string, nodes: PermNodeDto[]): Promise<ReplacePermNodesResult> {
    const menu = await this.repository.findOne({ where: { id, delFlag: 0 } })
    if (!menu) {
      throw new BizException(BizErrorCode.NOT_FOUND, '菜单不存在')
    }
    if (menu.menuType === 2) {
      throw new BizException(BizErrorCode.BUSINESS_ERROR, '按钮权限下不能再挂按钮节点')
    }

    // payload 内按 perms 去重（后出现的丢弃，保留首个的名称）
    const byPerms = new Map<string, PermNodeDto>()
    for (const node of nodes) {
      const perms = node.perms.trim()
      if (!byPerms.has(perms)) byPerms.set(perms, { ...node, perms })
    }
    const incoming = [...byPerms.values()]

    const result = await this.repository.manager.transaction(async manager => {
      const repo = manager.getRepository(MenuEntity)
      const existing = await repo.find({ where: { parentId: id, menuType: 2, delFlag: 0 } })
      const existingByPerms = new Map(existing.filter(m => m.perms).map(m => [m.perms!, m]))

      const added: string[] = []
      const removed: string[] = []
      const kept: string[] = []
      let nextSort = Math.max(0, ...existing.map(m => m.sortNo ?? 0))

      for (const node of incoming) {
        const hit = existingByPerms.get(node.perms)
        if (hit) {
          // 名称有变才写库，避免无谓的 update
          if (hit.name !== node.name) {
            await repo.update(hit.id, { name: node.name, updateTime: new Date() })
          }
          kept.push(node.perms)
        } else {
          // 主键 32 位上限：父 id + perms 清洗后截断 + 时间片，保证不超长且基本可读
          const cleaned = node.perms.replace(/[^a-zA-Z0-9]/g, '')
          const newId = `${id}_${cleaned}`.slice(0, 28) + Date.now().toString(36).slice(-4)
          await repo.insert({
            id: newId,
            parentId: id,
            name: node.name,
            perms: node.perms,
            menuType: 2,
            permsType: '1',
            status: '1',
            delFlag: 0,
            isRoute: 1,
            hidden: 0,
            sortNo: node.sortNo ?? ++nextSort,
            createTime: new Date()
          })
          added.push(node.perms)
        }
      }

      for (const [perms, row] of existingByPerms) {
        if (!byPerms.has(perms)) {
          await repo.update(row.id, { delFlag: 1, updateTime: new Date() })
          removed.push(perms)
        }
      }

      return { added, removed, kept }
    })

    // 按钮集合变了，所有角色的权限集合都要重算（幂等，无变化时缓存重建成本可接受）
    await this.permissionCache.invalidateAll()
    return result
  }

  /** 扁平列表转树（parent_id 为 null/'' 视为顶级） */
  async getTree(): Promise<MenuTreeItem[]> {
    const all = await this.listAll()
    return buildMenuTree(all, null)
  }

  /** 顶级菜单（供外部按父查询） */
  async listRoots(): Promise<MenuEntity[]> {
    return this.repository.find({ where: { parentId: IsNull(), delFlag: 0 }, order: { sortNo: 'ASC' } })
  }

  /** 父级必须存在且未删除 */
  private async assertParentExists(parentId: string): Promise<void> {
    const parent = await this.repository.findOne({ where: { id: parentId, delFlag: 0 } })
    if (!parent) {
      throw new BizException(BizErrorCode.BUSINESS_ERROR, `上级菜单不存在或已删除：${parentId}`)
    }
  }

  /** 换父级防环：新父级不能是自己或自己的后代（沿父链向上走，碰到自己即成环） */
  private async assertNoCycle(id: string, parentId: string): Promise<void> {
    if (parentId === id) {
      throw new BizException(BizErrorCode.BUSINESS_ERROR, '上级菜单不能是自己')
    }
    const all = await this.listAll()
    const byId = new Map(all.map(m => [m.id, m]))
    let cursor: string | null | undefined = parentId
    const visited = new Set<string>()
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor)
      if (cursor === id) {
        throw new BizException(BizErrorCode.BUSINESS_ERROR, '上级菜单不能是自己的后代（会形成循环层级）')
      }
      cursor = byId.get(cursor)?.parentId
    }
  }
}

/** list-to-tree：不递归查库，一次取全量后内存组装 */
export function buildMenuTree(all: MenuEntity[], parentId: string | null): MenuTreeItem[] {
  return all
    .filter(menu => (parentId === null ? isRootParent(menu.parentId) : menu.parentId === parentId))
    .map(menu =>
      // 实体实例展开为 plain object 组树（响应走 JSON 序列化，无原型丢失问题）
      // oxlint-disable-next-line typescript(no-misused-spread)
      ({
        ...menu,
        children: buildMenuTree(all, menu.id)
      })
    )
}
