import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull, Repository, type DeepPartial } from 'typeorm'

import { BizErrorCode } from '../../common/enums/biz-error-code.enum'
import { BizException } from '../../common/exceptions/biz.exception'
import { BaseService } from '../../helper/crud/base.service'
import { MenuEntity } from './entities/menu.entity'

export interface MenuTreeItem extends MenuEntity {
  children: MenuTreeItem[]
}

/** 顶级菜单的 parent_id 约定（JeecgBoot 用 null 或空串） */
function isRootParent(parentId?: string | null): boolean {
  return parentId === null || parentId === undefined || parentId === ''
}

@Injectable()
export class MenuService extends BaseService<MenuEntity> {
  constructor(
    @InjectRepository(MenuEntity)
    repository: Repository<MenuEntity>
  ) {
    super(repository, '菜单')
  }

  /** 创建：补 JeecgBoot 默认值（未删除、有效、是路由、不隐藏） */
  async create(dto: DeepPartial<MenuEntity>): Promise<MenuEntity> {
    if (dto.parentId) {
      await this.assertParentExists(dto.parentId)
    }
    return super.create({
      ...dto,
      delFlag: dto.delFlag ?? 0,
      status: dto.status ?? '1',
      isRoute: dto.isRoute ?? 1,
      hidden: dto.hidden ?? 0,
      permsType: dto.permsType ?? '1',
      sortNo: dto.sortNo ?? 0,
      createTime: new Date()
    })
  }

  /** 更新：维护更新时间；换父级时校验父级存在且不形成环 */
  async update(id: string, dto: DeepPartial<MenuEntity>): Promise<MenuEntity> {
    if (dto.parentId) {
      await this.assertNoCycle(id, dto.parentId)
    }
    return super.update(id, { ...dto, updateTime: new Date() })
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
  }

  /** 全量菜单（按 sort_no 升序，排除已删除） */
  async listAll(): Promise<MenuEntity[]> {
    return this.repository.find({ where: { delFlag: 0 }, order: { sortNo: 'ASC', id: 'ASC' } })
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
