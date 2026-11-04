import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'

import { BaseService } from '../../helper/crud/base.service'
import { RoleEntity } from './entities/role.entity'
import { MenuEntity } from '../menu/entities/menu.entity'
import type { CreateRoleDto } from './dto/create-role.dto'
import type { QueryRoleDto } from './dto/query-role.dto'
import type { UpdateRoleDto } from './dto/update-role.dto'

@Injectable()
export class RoleService extends BaseService<RoleEntity> {
  constructor(
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>
  ) {
    super(roleRepository, '角色')
  }

  /** 角色列表（含已授权菜单），角色数量少不分页，keyword 模糊匹配名称/编码 */
  async listByQuery(query: QueryRoleDto): Promise<RoleEntity[]> {
    const roles = await this.roleRepository.find({ relations: { permissions: true }, order: { createTime: 'ASC' } })
    const keyword = query.keyword?.trim().toLowerCase()
    if (!keyword) {
      return roles
    }
    return roles.filter(role => (role.roleName ?? '').toLowerCase().includes(keyword) || (role.roleCode ?? '').toLowerCase().includes(keyword))
  }

  /** 创建角色，支持 menuIds 绑定菜单权限（id 由 BaseService 自动生成 32 位） */
  async createRole(dto: CreateRoleDto): Promise<RoleEntity> {
    await this.assertCodeAvailable(dto.roleCode)
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

  /** 更新角色基础信息，可同时传 menuIds 覆盖授权；内置 admin 角色编码不允许修改 */
  async updateRole(id: string, dto: UpdateRoleDto): Promise<RoleEntity> {
    const role = await this.findOne(id)
    if (dto.roleCode && dto.roleCode !== role.roleCode) {
      if (role.roleCode === 'admin') {
        throw new BadRequestException('内置管理员角色的编码不允许修改')
      }
      await this.assertCodeAvailable(dto.roleCode)
    }
    await this.roleRepository.update(id, { roleName: dto.roleName, roleCode: dto.roleCode, description: dto.description })
    if (dto.menuIds) {
      await this.assignMenus(id, dto.menuIds)
    }
    return this.findOneWithMenus(id)
  }

  /**
   * 删除角色（硬删）
   * 保护规则：内置 admin 角色不可删；角色下仍有用户时拒绝，需先解绑；
   * 删除前清理 sys_role_permission 关联行，避免外键约束残留
   */
  async deleteRole(id: string): Promise<void> {
    const role = await this.findOne(id)
    if (role.roleCode === 'admin') {
      throw new BadRequestException('内置管理员角色不允许删除')
    }
    const users = await this.roleRepository.createQueryBuilder().relation(RoleEntity, 'users').of(id).loadMany<{ id: string }>()
    if (users.length) {
      throw new BadRequestException(`该角色下还有 ${users.length} 个用户，请先解绑后再删除`)
    }
    const menus = await this.roleRepository.createQueryBuilder().relation(RoleEntity, 'permissions').of(id).loadMany<MenuEntity>()
    if (menus.length) {
      await this.roleRepository
        .createQueryBuilder()
        .relation(RoleEntity, 'permissions')
        .of(id)
        .remove(menus.map(menu => menu.id))
    }
    await this.roleRepository.delete(id)
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

  /** 校验角色编码未被占用（数据库有唯一索引，提前拦截给出可读报错） */
  private async assertCodeAvailable(roleCode: string): Promise<void> {
    const exists = await this.roleRepository.findOne({ where: { roleCode } })
    if (exists) {
      throw new BadRequestException(`角色编码「${roleCode}」已存在`)
    }
  }
}
