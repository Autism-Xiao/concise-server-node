import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'

import { BusinessException } from '../../common/exceptions/business.exception'
import { BaseService } from '../../helper/crud/base.service'
import { paginate, type PaginateOptions, type Pagination } from '../../helper/paginate'
import { encryptPassword, randomId32, randomSalt } from '../../utils/password.util'
import { UserEntity } from './entities/user.entity'
import { RoleEntity } from '../role/entities/role.entity'
import type { QueryUserDto } from './dto/query-user.dto'

/** 用户状态（对齐 sys_user）：1 正常 / 2 冻结 */
export const USER_STATUS = { NORMAL: 1, FROZEN: 2 } as const

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

  /** 创建：生成 32 位主键与密码盐，密码按 JeecgBoot 算法 PBEWithMD5AndDES(username, password, salt) 入库 */
  async create(dto: Partial<UserEntity> & { roleIds?: string[] }, operator?: string): Promise<UserEntity> {
    const data: Partial<UserEntity> = { ...dto }
    delete (data as { roleIds?: string[] }).roleIds
    data.id = data.id || randomId32()
    data.salt = randomSalt()
    if (data.password) {
      data.password = encryptPassword(data.username as string, data.password, data.salt)
    }
    data.status = data.status || USER_STATUS.NORMAL
    data.delFlag = 0
    if (operator) {
      data.createBy = operator
      data.updateBy = operator
    }
    if (!data.createTime) {
      data.createTime = new Date()
    }
    const user = await super.create(data)
    if (dto.roleIds?.length) {
      await this.assignRoles(user.id, dto.roleIds)
    }
    return this.findOneDetail(user.id) as Promise<UserEntity>
  }

  /** 更新：若携带密码则生成新盐重新加密；携带 roleIds 则重绑角色 */
  async update(id: string, dto: Partial<UserEntity> & { roleIds?: string[] }, operator?: string): Promise<UserEntity> {
    const data: Partial<UserEntity> = { ...dto }
    delete (data as { roleIds?: string[] }).roleIds
    delete data.username // 账号不允许修改（密码算法绑定 username）
    if (data.password) {
      data.salt = randomSalt()
      const user = await this.findOneWithPassword(id)
      data.password = encryptPassword(user?.username ?? '', data.password, data.salt)
    }
    if (operator) {
      data.updateBy = operator
    }
    data.updateTime = new Date()
    await super.update(id, data)
    if (dto.roleIds) {
      await this.assignRoles(id, dto.roleIds)
    }
    return this.findOneDetail(id) as Promise<UserEntity>
  }

  /** 绑定角色（全量覆盖：多退少补） */
  async assignRoles(id: string, roleIds: string[]): Promise<void> {
    await this.findOne(id)
    const roles = await this.roleRepository.findBy({ id: In(roleIds) })
    const nextIds = new Set(roleIds)
    const current = await this.repository.createQueryBuilder().relation(UserEntity, 'roles').of(id).loadMany<RoleEntity>()
    const currentIds = new Set(current.map(role => role.id))
    // 只新增差集、删除差集，避免重复插入关联行
    const toAdd = roles.filter(role => !currentIds.has(role.id))
    const toRemove = current.filter(role => !nextIds.has(role.id))
    await this.repository.createQueryBuilder().relation(UserEntity, 'roles').of(id).addAndRemove(toAdd, toRemove)
  }

  /** 分页列表：支持 keyword 模糊搜索账号/真实姓名/电话、status 精确过滤；过滤已软删 */
  async listByQuery(query: QueryUserDto): Promise<Pagination<UserEntity>> {
    const qb = this.repository.createQueryBuilder('user').where('user.del_flag = 0').orderBy('user.create_time', 'DESC')

    if (query.keyword) {
      qb.andWhere('(user.username LIKE :keyword OR user.realname LIKE :keyword OR user.phone LIKE :keyword)', {
        keyword: `%${query.keyword}%`
      })
    }
    if (query.status !== undefined && query.status !== '') {
      qb.andWhere('user.status = :status', { status: Number(query.status) })
    }
    if (query.deptId !== undefined && query.deptId !== null) {
      qb.andWhere('user.dept_id = :deptId', { deptId: query.deptId })
    }

    const options: PaginateOptions = { page: query.page, pageSize: query.pageSize }
    qb.leftJoinAndSelect('user.dept', 'dept')
    return paginate(qb, options)
  }

  /** 单查覆盖：过滤已软删用户 */
  async findOne(id: string): Promise<UserEntity> {
    const user = await this.repository.findOne({ where: { id, delFlag: 0 } })
    if (!user) {
      throw new NotFoundException('用户不存在')
    }
    return user
  }

  /** 按 id 查找并带出角色（过滤已软删） */
  async findOneWithRoles(id: string): Promise<UserEntity | null> {
    return this.repository.findOne({ where: { id, delFlag: 0 }, relations: { roles: true } })
  }

  /** 详情：带出角色 + 部门（过滤已软删，不存在抛 404） */
  async findOneDetail(id: string): Promise<UserEntity> {
    const user = await this.repository.findOne({ where: { id, delFlag: 0 }, relations: { roles: true, dept: true } })
    if (!user) {
      throw new NotFoundException('用户不存在')
    }
    return user
  }

  /** 按 id 查找（含密码与盐，仅供认证场景使用；过滤已软删） */
  async findOneWithPassword(id: string): Promise<UserEntity | null> {
    return this.repository
      .createQueryBuilder('user')
      .addSelect(['user.password', 'user.salt'])
      .where('user.id = :id', { id })
      .andWhere('user.del_flag = 0')
      .getOne()
  }

  /** 按用户名查找并带出角色（登录用，密码与盐显式加查；过滤已软删） */
  async findByUsername(username: string): Promise<UserEntity | null> {
    return this.repository
      .createQueryBuilder('user')
      .addSelect(['user.password', 'user.salt'])
      .leftJoinAndSelect('user.roles', 'role')
      .where('user.username = :username', { username })
      .andWhere('user.del_flag = 0')
      .getOne()
  }

  /** 软删除（对齐 sys_user.del_flag）：置 del_flag=1 而非物理删除；admin 不可删除 */
  async delete(id: string): Promise<void> {
    const user = await this.findOne(id)
    if (user.username === 'admin') {
      throw new BusinessException('内置管理员账号不允许删除', 400)
    }
    await this.repository.update(id, { delFlag: 1 })
  }

  /** 校验登录密码：JeecgBoot 算法 PBEWithMD5AndDES(username, password, salt) */
  verifyPassword(user: UserEntity, plainPassword: string): boolean {
    if (!user.password || !user.salt) {
      return false
    }
    return encryptPassword(user.username, plainPassword, user.salt) === user.password
  }

  /** 去掉密码与盐字段，安全返回 */
  stripPassword(user: UserEntity): Omit<UserEntity, 'password' | 'salt'> {
    const { password: _password, salt: _salt, ...rest } = user
    void _password
    void _salt
    return rest
  }
}
