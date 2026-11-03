import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import * as bcrypt from 'bcryptjs'

import { BaseService } from '../../helper/crud/base.service'
import { paginate, type PaginateOptions, type Pagination } from '../../helper/paginate'
import { UserEntity } from './entities/user.entity'
import { RoleEntity } from '../role/entities/role.entity'
import type { QueryUserDto } from './dto/query-user.dto'

@Injectable()
export class UserService extends BaseService<UserEntity> {
  constructor(
    @InjectRepository(UserEntity)
    repository: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>
  ) {
    super(repository, '用户')
  }

  /** 创建：密码自动 bcrypt 哈希后入库；支持 roleIds 直接绑角色 */
  async create(dto: Partial<UserEntity> & { roleIds?: number[] }): Promise<UserEntity> {
    const data: Partial<UserEntity> = { ...dto }
    delete (data as { roleIds?: number[] }).roleIds
    if (data.password) {
      data.password = await bcrypt.hash(data.password, 10)
    }
    const user = await super.create(data)
    if (dto.roleIds?.length) {
      await this.assignRoles(user.id, dto.roleIds)
    }
    return this.findOneDetail(user.id) as Promise<UserEntity>
  }

  /** 更新：若携带密码同样先哈希；携带 roleIds 则重绑角色 */
  async update(id: number, dto: Partial<UserEntity> & { roleIds?: number[] }): Promise<UserEntity> {
    const data: Partial<UserEntity> = { ...dto }
    delete (data as { roleIds?: number[] }).roleIds
    if (data.password) {
      data.password = await bcrypt.hash(data.password, 10)
    }
    await super.update(id, data)
    if (dto.roleIds) {
      await this.assignRoles(id, dto.roleIds)
    }
    return this.findOneDetail(id) as Promise<UserEntity>
  }

  /** 绑定角色（全量覆盖） */
  async assignRoles(id: number, roleIds: number[]): Promise<void> {
    await this.findOne(id)
    const roles = await this.roleRepository.findBy({ id: In(roleIds) })
    await this.repository.createQueryBuilder().relation(UserEntity, 'roles').of(id).addAndRemove(roles, [])
  }

  /** 分页列表：支持 keyword 模糊搜索用户名/昵称、status 精确过滤 */
  async listByQuery(query: QueryUserDto): Promise<Pagination<UserEntity>> {
    const qb = this.repository.createQueryBuilder('user').orderBy('user.id', 'DESC')

    if (query.keyword) {
      qb.andWhere('(user.username LIKE :keyword OR user.nickname LIKE :keyword)', {
        keyword: `%${query.keyword}%`
      })
    }
    if (query.status !== undefined && query.status !== '') {
      qb.andWhere('user.status = :status', { status: Number(query.status) })
    }
    if (query.deptId !== undefined && query.deptId !== null) {
      qb.andWhere('user.deptId = :deptId', { deptId: query.deptId })
    }

    const options: PaginateOptions = { page: query.page, pageSize: query.pageSize }
    qb.leftJoinAndSelect('user.dept', 'dept')
    return paginate(qb, options)
  }

  /** 按 id 查找并带出角色 */
  async findOneWithRoles(id: number): Promise<UserEntity | null> {
    return this.repository.findOne({ where: { id }, relations: { roles: true } })
  }

  /** 详情：带出角色 + 部门 */
  async findOneDetail(id: number): Promise<UserEntity | null> {
    return this.repository.findOne({ where: { id }, relations: { roles: true, dept: true } })
  }

  /** 按 id 查找（含密码，仅供认证场景使用） */
  async findOneWithPassword(id: number): Promise<UserEntity | null> {
    return this.repository.createQueryBuilder('user').addSelect('user.password').where('user.id = :id', { id }).getOne()
  }

  /** 按用户名查找并带出角色（登录用，密码显式加查） */
  async findByUsername(username: string): Promise<UserEntity | null> {
    return this.repository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .leftJoinAndSelect('user.roles', 'role')
      .where('user.username = :username', { username })
      .getOne()
  }

  /** 去掉密码字段，安全返回 */
  stripPassword(user: UserEntity): Omit<UserEntity, 'password'> {
    const { password: _password, ...rest } = user
    void _password
    return rest
  }
}
