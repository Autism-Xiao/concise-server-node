import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import * as bcrypt from 'bcryptjs'

import { BusinessException } from '../../common/exceptions/business.exception'
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

  /** 创建：密码自动 bcrypt 哈希后入库；支持 roleIds 直接绑角色；operator 为创建人 */
  async create(dto: Partial<UserEntity> & { roleIds?: number[] }, operator?: string): Promise<UserEntity> {
    const data: Partial<UserEntity> = { ...dto }
    delete (data as { roleIds?: number[] }).roleIds
    if (operator) {
      data.createBy = operator
      data.updateBy = operator
    }
    if (data.password) {
      data.password = await bcrypt.hash(data.password, 10)
    }
    const user = await super.create(data)
    if (dto.roleIds?.length) {
      await this.assignRoles(user.id, dto.roleIds)
    }
    return this.findOneDetail(user.id) as Promise<UserEntity>
  }

  /** 更新：若携带密码同样先哈希；携带 roleIds 则重绑角色；operator 为更新人 */
  async update(id: number, dto: Partial<UserEntity> & { roleIds?: number[] }, operator?: string): Promise<UserEntity> {
    const data: Partial<UserEntity> = { ...dto }
    delete (data as { roleIds?: number[] }).roleIds
    if (operator) {
      data.updateBy = operator
    }
    if (data.password) {
      data.password = await bcrypt.hash(data.password, 10)
    }
    await super.update(id, data)
    if (dto.roleIds) {
      await this.assignRoles(id, dto.roleIds)
    }
    return this.findOneDetail(id) as Promise<UserEntity>
  }

  /** 软删除（对齐 sys_user.del_flag）：置 delFlag=1 而非物理删除；admin 不可删除 */
  async delete(id: number): Promise<void> {
    const user = await this.findOne(id)
    if (user.username === 'admin') {
      throw new BusinessException('内置管理员账号不允许删除', 400)
    }
    await this.repository.update(id, { delFlag: 1 })
  }

  /** 单查覆盖：过滤已软删用户 */
  async findOne(id: number): Promise<UserEntity> {
    const user = await this.repository.findOne({ where: { id, delFlag: 0 } })
    if (!user) {
      throw new NotFoundException('用户不存在')
    }
    return user
  }

  /** 绑定角色（全量覆盖） */
  async assignRoles(id: number, roleIds: number[]): Promise<void> {
    await this.findOne(id)
    const roles = await this.roleRepository.findBy({ id: In(roleIds) })
    await this.repository.createQueryBuilder().relation(UserEntity, 'roles').of(id).addAndRemove(roles, [])
  }

  /** 分页列表：支持 keyword 模糊搜索用户名/真实姓名/手机号、status 精确过滤；过滤已软删 */
  async listByQuery(query: QueryUserDto): Promise<Pagination<UserEntity>> {
    const qb = this.repository.createQueryBuilder('user').where('user.delFlag = 0').orderBy('user.id', 'DESC')

    if (query.keyword) {
      qb.andWhere('(user.username LIKE :keyword OR user.realname LIKE :keyword OR user.phone LIKE :keyword)', {
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

  /** 按 id 查找并带出角色（过滤已软删） */
  async findOneWithRoles(id: number): Promise<UserEntity | null> {
    return this.repository.findOne({ where: { id, delFlag: 0 }, relations: { roles: true } })
  }

  /** 详情：带出角色 + 部门（过滤已软删，不存在抛 404） */
  async findOneDetail(id: number): Promise<UserEntity> {
    const user = await this.repository.findOne({ where: { id, delFlag: 0 }, relations: { roles: true, dept: true } })
    if (!user) {
      throw new NotFoundException('用户不存在')
    }
    return user
  }

  /** 按 id 查找（含密码，仅供认证场景使用；过滤已软删） */
  async findOneWithPassword(id: number): Promise<UserEntity | null> {
    return this.repository.createQueryBuilder('user').addSelect('user.password').where('user.id = :id', { id }).andWhere('user.delFlag = 0').getOne()
  }

  /** 按用户名查找并带出角色（登录用，密码显式加查；过滤已软删） */
  async findByUsername(username: string): Promise<UserEntity | null> {
    return this.repository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .leftJoinAndSelect('user.roles', 'role')
      .where('user.username = :username', { username })
      .andWhere('user.delFlag = 0')
      .getOne()
  }

  /** 去掉密码字段，安全返回 */
  stripPassword(user: UserEntity): Omit<UserEntity, 'password'> {
    const { password: _password, ...rest } = user
    void _password
    return rest
  }
}
