import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { BaseService } from '../../helper/crud/base.service'
import { MenuEntity } from './entities/menu.entity'

export interface MenuTreeItem extends MenuEntity {
  children: MenuTreeItem[]
}

@Injectable()
export class MenuService extends BaseService<MenuEntity> {
  constructor(
    @InjectRepository(MenuEntity)
    repository: Repository<MenuEntity>
  ) {
    super(repository, '菜单')
  }

  /** 全量菜单（按 sort 升序） */
  async listAll(): Promise<MenuEntity[]> {
    return this.repository.find({ order: { sort: 'ASC', id: 'ASC' } })
  }

  /** 扁平列表转树（parentId = 0 为顶级） */
  async getTree(): Promise<MenuTreeItem[]> {
    const all = await this.listAll()
    return buildMenuTree(all, 0)
  }
}

/** list-to-tree：不递归查库，一次取全量后内存组装 */
export function buildMenuTree(all: MenuEntity[], parentId: number): MenuTreeItem[] {
  return all
    .filter(menu => menu.parentId === parentId)
    .map(menu => ({
      ...menu,
      children: buildMenuTree(all, menu.id)
    }))
}
