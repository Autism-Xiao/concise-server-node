import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'

import { BusinessException } from '../../common/exceptions/business.exception'
import { BaseService } from '../../helper/crud/base.service'
import { paginate, type PaginateOptions, type Pagination } from '../../helper/paginate'
import { encryptPassword, randomId32, randomSalt } from '../../utils/password.util'
import { DeptEntity } from '../system/dept/entities/dept.entity'
import { UserEntity } from './entities/user.entity'
import { RoleEntity } from '../role/entities/role.entity'
import type { QueryUserDto } from './dto/query-user.dto'

/** 用户状态（对齐 sys_user）：1 正常 / 2 冻结 */
export const USER_STATUS = { NORMAL: 1, FROZEN: 2 } as const

/**
 * 创建/更新入参
 * - 实体字段之外，附带角色、部门 id 列表（关联关系不落在主表，需单独写关联表）
 * - deptId 为旧字段，等价 deptIds: [deptId]
 */
type UserWriteInput = Partial<UserEntity> & { roleIds?: string[]; deptIds?: string[]; deptId?: string }

/** 归一化部门 id：deptIds 优先，其次兼容单个 deptId；去重去空并保持入参顺序（首个为主部门） */
function normalizeDeptIds(deptIds?: string[], deptId?: string): string[] {
  return [...new Set((deptIds ?? (deptId ? [deptId] : [])).filter(Boolean))]
}

@Injectable()
export class UserService extends BaseService<UserEntity> {
  constructor(
    @InjectRepository(UserEntity)
    repository: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    @InjectRepository(DeptEntity)
    private readonly deptRepository: Repository<DeptEntity>
  ) {
    super(repository, '用户')
  }

  /** 创建：生成 32 位主键与密码盐，密码按 JeecgBoot 算法 PBEWithMD5AndDES(username, password, salt) 入库 */
  async create(dto: UserWriteInput, operator?: string): Promise<UserEntity> {
    const { roleIds, deptIds, deptId, ...rest } = dto
    const data: Partial<UserEntity> = { ...rest }
    this.stripUnwritableFields(data)
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
    if (roleIds?.length) {
      await this.assignRoles(user.id, roleIds)
    }
    const nextDeptIds = normalizeDeptIds(deptIds, deptId)
    if (nextDeptIds.length) {
      await this.assignDepts(user.id, nextDeptIds)
    }
    return this.findOneDetail(user.id) as Promise<UserEntity>
  }

  /** 更新：若携带密码则生成新盐重新加密；携带 roleIds / deptIds 则重绑关联 */
  async update(id: string, dto: UserWriteInput, operator?: string): Promise<UserEntity> {
    const { roleIds, deptIds, deptId, ...rest } = dto
    const data: Partial<UserEntity> = { ...rest }
    this.stripUnwritableFields(data)
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
    if (roleIds) {
      await this.assignRoles(id, roleIds)
    }
    // 传了 deptIds（含空数组）或旧字段 deptId 才重绑部门；都不传则保持原样
    if (deptIds !== undefined || deptId !== undefined) {
      await this.assignDepts(id, normalizeDeptIds(deptIds, deptId))
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

  /**
   * 绑定部门（全量覆盖，对齐 JeecgBoot sys_user_depart）
   * - 入参顺序即主次顺序，第一个为主部门
   * - 同步冗余：sys_user.depart_ids（逗号串）、sys_user.org_code（主部门机构编码）
   */
  async assignDepts(id: string, deptIds: string[]): Promise<void> {
    await this.findOne(id)
    const ids = [...new Set(deptIds.filter(Boolean))]
    const depts = ids.length ? await this.deptRepository.find({ where: { id: In(ids), delFlag: '0' } }) : []
    if (depts.length !== ids.length) {
      const found = new Set(depts.map(dept => dept.id))
      throw new BusinessException(`部门不存在或已删除：${ids.filter(depId => !found.has(depId)).join(',')}`, 400)
    }
    const deptMap = new Map(depts.map(dept => [dept.id, dept]))
    const ordered = ids.map(depId => deptMap.get(depId) as DeptEntity)

    const current = await this.repository.createQueryBuilder().relation(UserEntity, 'depts').of(id).loadMany<DeptEntity>()
    const currentIds = new Set(current.map(dept => dept.id))
    const toAdd = ordered.filter(dept => !currentIds.has(dept.id))
    const toRemove = current.filter(dept => !ids.includes(dept.id))
    if (toAdd.length || toRemove.length) {
      await this.repository.createQueryBuilder().relation(UserEntity, 'depts').of(id).addAndRemove(toAdd, toRemove)
    }

    await this.repository.update(id, {
      departIds: ids.length ? ids.join(',') : null,
      orgCode: ordered[0]?.orgCode ?? null
    })
  }

  /** 分页列表：支持 keyword 模糊搜索账号/真实姓名/电话、status 精确过滤、部门过滤；过滤已软删 */
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
    // 部门过滤：命中 sys_user_depart 任一部门即返回（deptId 与 deptIds 取并集）
    const deptFilters = [
      ...(query.deptId ? [query.deptId] : []),
      ...(query.deptIds
        ? query.deptIds
            .split(',')
            .map(value => value.trim())
            .filter(Boolean)
        : [])
    ]
    if (deptFilters.length) {
      qb.andWhere('EXISTS (SELECT 1 FROM `sys_user_depart` ud WHERE ud.`user_id` = user.id AND ud.`dep_id` IN (:...deptFilters))', {
        deptFilters
      })
    }

    const options: PaginateOptions = { page: query.page, pageSize: query.pageSize }
    const result = await paginate(qb, options)
    await this.attachDepts(result.items)
    return result
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
    const user = await this.repository.findOne({ where: { id, delFlag: 0 }, relations: { roles: true, depts: true } })
    if (user) {
      this.applyDepts(user)
    }
    return user
  }

  /** 详情：带出角色 + 部门（过滤已软删，不存在抛 404） */
  async findOneDetail(id: string): Promise<UserEntity> {
    const user = await this.repository.findOne({ where: { id, delFlag: 0 }, relations: { roles: true, depts: true } })
    if (!user) {
      throw new NotFoundException('用户不存在')
    }
    this.applyDepts(user)
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

  /** 按用户名查找并带出角色、部门（登录用，密码与盐显式加查；过滤已软删） */
  async findByUsername(username: string): Promise<UserEntity | null> {
    const user = await this.repository
      .createQueryBuilder('user')
      .addSelect(['user.password', 'user.salt'])
      .leftJoinAndSelect('user.roles', 'role')
      .leftJoinAndSelect('user.depts', 'dept')
      .where('user.username = :username', { username })
      .andWhere('user.del_flag = 0')
      .getOne()
    if (user) {
      this.applyDepts(user)
    }
    return user
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

  /**
   * 去掉不允许客户端直接写入的字段
   * - depts / dept：关系字段与组装字段，非数据库列
   * - depart_ids / org_code：由 assignDepts 按主部门统一维护，避免两处写法互相覆盖
   */
  private stripUnwritableFields(data: Partial<UserEntity>): void {
    delete data.depts
    delete data.dept
    delete data.departIds
    delete data.orgCode
  }

  /** 按 depart_ids 顺序整理部门，并把 depts[0] 同步到兼容字段 dept */
  private applyDepts(user: UserEntity): void {
    user.depts = this.orderDepts(user.depts ?? [], user.departIds)
    user.dept = user.depts[0] ?? null
  }

  /** 批量补部门（列表页一次查关联表，避免 N+1） */
  private async attachDepts(users: UserEntity[]): Promise<void> {
    if (!users.length) {
      return
    }
    const rows = await this.repository.find({
      where: { id: In(users.map(user => user.id)) },
      relations: { depts: true }
    })
    const deptMap = new Map(rows.map(row => [row.id, this.orderDepts(row.depts ?? [], row.departIds)]))
    for (const user of users) {
      user.depts = deptMap.get(user.id) ?? []
      user.dept = user.depts[0] ?? null
    }
  }

  /** 按 depart_ids 的先后排序（未登记的排最后） */
  private orderDepts(depts: DeptEntity[], departIds?: string | null): DeptEntity[] {
    if (!departIds) {
      return depts
    }
    const rank = new Map(
      departIds
        .split(',')
        .filter(Boolean)
        .map((depId, index) => [depId, index])
    )
    const last = Number.MAX_SAFE_INTEGER
    return [...depts].sort((a, b) => (rank.get(a.id) ?? last) - (rank.get(b.id) ?? last))
  }
}
