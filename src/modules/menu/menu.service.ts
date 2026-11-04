import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull, Repository, type DeepPartial } from 'typeorm'

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
