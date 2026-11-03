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

  /** 创建角色，支持 menuIds 绑定菜单权限 */
  async createRole(dto: CreateRoleDto): Promise<RoleEntity> {
    const role = await this.create({
      name: dto.name,
      label: dto.label,
      status: dto.status,
      remark: dto.remark
    })
    if (dto.menuIds?.length) {
      await this.assignMenus(role.id, dto.menuIds)
    }
    return this.findOneWithMenus(role.id)
  }

  /** 绑定菜单权限（全量覆盖） */
  async assignMenus(id: number, menuIds: number[]): Promise<void> {
    await this.findOne(id)
    const menus = await this.roleRepository.manager.getRepository(MenuEntity).find({ where: { id: In(menuIds) } })
    if (menus.length !== menuIds.length) {
      throw new NotFoundException('存在无效的菜单 ID')
    }
    await this.roleRepository.createQueryBuilder().relation(RoleEntity, 'menus').of(id).addAndRemove(menus, [])
  }

  /** 查角色详情（含菜单） */
  async findOneWithMenus(id: number): Promise<RoleEntity> {
    const role = await this.roleRepository.findOne({ where: { id }, relations: { menus: true } })
    if (!role) {
      throw new NotFoundException('角色不存在')
    }
    return role
  }

  /** 按 id 列表查角色 */
  async findByIds(ids: number[]): Promise<RoleEntity[]> {
    return this.roleRepository.findBy({ id: In(ids) })
  }
}
