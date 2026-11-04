import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'

import { BaseService } from '../../helper/crud/base.service'
import { RoleEntity } from './entities/role.entity'
import { MenuEntity } from '../menu/entities/menu.entity'
import type { CreateRoleDto } from './dto/create-role.dto'

@Injectable()
export class RoleService extends BaseService<RoleEntity> {
  constructor(
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>
  ) {
    super(roleRepository, '角色')
  }

  /** 创建角色，支持 menuIds 绑定菜单权限（id 由 BaseService 自动生成 32 位） */
  async createRole(dto: CreateRoleDto): Promise<RoleEntity> {
    const role = await this.create({
      roleName: dto.roleName,
      roleCode: dto.roleCode,
      description: dto.description
    })
    if (dto.menuIds?.length) {
      await this.assignMenus(role.id, dto.menuIds)
    }
    return this.findOneWithMenus(role.id)
  }

  /** 绑定菜单权限（全量覆盖：多退少补） */
  async assignMenus(id: string, menuIds: string[]): Promise<void> {
    await this.findOne(id)
    const menus = await this.roleRepository.manager.getRepository(MenuEntity).find({ where: { id: In(menuIds) } })
    if (menus.length !== menuIds.length) {
      throw new NotFoundException('存在无效的菜单 ID')
    }
    const nextIds = new Set(menuIds)
    const current = await this.roleRepository.createQueryBuilder().relation(RoleEntity, 'permissions').of(id).loadMany<MenuEntity>()
    const currentIds = new Set(current.map(menu => menu.id))
    // 只新增差集、删除差集，避免重复插入关联行
    const toAdd = menus.filter(menu => !currentIds.has(menu.id))
    const toRemove = current.filter(menu => !nextIds.has(menu.id))
    await this.roleRepository.createQueryBuilder().relation(RoleEntity, 'permissions').of(id).addAndRemove(toAdd, toRemove)
  }

  /** 查角色详情（含菜单权限） */
  async findOneWithMenus(id: string): Promise<RoleEntity> {
    const role = await this.roleRepository.findOne({ where: { id }, relations: { permissions: true } })
    if (!role) {
      throw new NotFoundException('角色不存在')
    }
    return role
  }

  /** 按 id 列表查角色 */
  async findByIds(ids: string[]): Promise<RoleEntity[]> {
    return this.roleRepository.findBy({ id: In(ids) })
  }
}
