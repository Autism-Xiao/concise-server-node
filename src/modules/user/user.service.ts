import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository, SelectQueryBuilder } from 'typeorm'

import { BizErrorCode } from '../../common/enums/biz-error-code.enum'
import { BizException } from '../../common/exceptions/biz.exception'
import { BaseService } from '../../helper/crud/base.service'
import { paginate, type PaginateOptions, type Pagination } from '../../helper/paginate'
import { encryptPassword, randomId32, randomSalt } from '../../utils/password.util'
import { DeptEntity } from '../system/dept/entities/dept.entity'
import { UserEntity } from './entities/user.entity'
import { RoleEntity } from '../role/entities/role.entity'
import type { QueryUserDto } from './dto/query-user.dto'

/** 用户状态（对齐 sys_user）：1 正常 / 2 冻结 */
export const USER_STATUS = { NORMAL: 1, FROZEN: 2 } as const

/** 导出上限：单文件 5000 行，避免一次把几十万用户塞进内存 */
export const USER_EXPORT_MAX_ROWS = 5000

/** 导入单文件上限：2000 行、5MB（与角色导入保持一致） */
export const USER_IMPORT_MAX_ROWS = 2000
export const USER_IMPORT_MAX_SIZE = 5 * 1024 * 1024

/** 导入时密码列留空使用的初始密码（与前端「新增用户」默认值一致） */
export const USER_IMPORT_DEFAULT_PASSWORD = '123456'

/** 登录账号规则：3~100 位，字母开头，允许字母/数字/下划线/点/横线/@（与登录框输入习惯一致的宽松规则） */
const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.@-]{2,99}$/

/** 导入结果：逐行统计 + 失败明细（前端据此展示导入报告） */
export interface UserImportResult {
  /** 参与解析的数据行数（不含表头、空行） */
  total: number
  created: number
  updated: number
  /** 跳过行数（同一份文件内账号重复） */
  skipped: number
  failed: number
  errors: Array<{ row: number; username: string; message: string }>
}

/** 导入列：key 与模板表头别名对应 */
type UserImportField = 'username' | 'realname' | 'password' | 'phone' | 'email' | 'sex' | 'birthday' | 'workNo' | 'deptNames' | 'roleNames' | 'status'

/** 表头别名：兼容用户手改列名、或从别处复制过来的表头 */
const USER_IMPORT_ALIASES: Record<UserImportField, string[]> = {
  username: ['登录账号', '账号', '用户名', 'username'],
  realname: ['真实姓名', '姓名', 'realname'],
  password: ['密码', '初始密码', 'password'],
  phone: ['手机号', '手机', '电话', 'phone'],
  email: ['邮箱', '电子邮件', 'email'],
  sex: ['性别', 'sex'],
  birthday: ['生日', '出生日期', 'birthday'],
  workNo: ['工号', 'workno'],
  deptNames: ['所属部门', '部门', 'deptname', 'dept'],
  roleNames: ['角色', '角色名称', '角色编码', 'role'],
  status: ['状态', 'status']
}

/** 多值分隔符：斜杠/中英文逗号/顿号/分号/竖线，导入时都当分隔符，避免用户纠结用哪个 */
const MULTI_VALUE_SEPARATOR = /[/,，、;；|]+/

/** 性别可读值 → 数据库值（0 未知 / 1 男 / 2 女） */
const SEX_LABELS: Record<string, number> = { 男: 1, 女: 2, 未知: 0, 1: 1, 2: 2, 0: 0, male: 1, female: 2 }

/** 状态可读值 → 数据库值（1 正常 / 2 冻结） */
const STATUS_LABELS: Record<string, number> = { 正常: 1, 启用: 1, 1: 1, 冻结: 2, 停用: 2, 禁用: 2, 2: 2 }

/** 拆分多值单元格并去空去重（保留原顺序，第一个部门即主部门） */
function splitMultiValue(raw: string): string[] {
  if (!raw) {
    return []
  }
  return [
    ...new Set(
      raw
        .split(MULTI_VALUE_SEPARATOR)
        .map(item => item.trim())
        .filter(Boolean)
    )
  ]
}

/** 日期归一：接受 1990-01-01 / 1990/1/1 / 1990.1.1，统一成 YYYY-MM-DD；非法返回 null */
function normalizeDateText(raw: string): string | null {
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw.trim())
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

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
      throw new BizException(BizErrorCode.BUSINESS_ERROR, `部门不存在或已删除：${ids.filter(depId => !found.has(depId)).join(',')}`)
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
      orgCode: ordered[0]?.orgCode ?? null,
      updateTime: new Date()
    })
  }

  /** 分页列表：支持 keyword 模糊搜索账号/真实姓名/电话、status 精确过滤、部门过滤；过滤已软删 */
  async listByQuery(query: QueryUserDto): Promise<Pagination<UserEntity>> {
    const options: PaginateOptions = { page: query.page, pageSize: query.pageSize }
    const result = await paginate(this.buildListQuery(query), options)
    await this.attachDepts(result.records)
    await this.attachRoles(result.records)
    return result
  }

  /** 导出用户：与列表同过滤条件、不分页（上限 USER_EXPORT_MAX_ROWS），带部门与角色 */
  async exportUsers(query: QueryUserDto): Promise<UserEntity[]> {
    const users = await this.buildListQuery(query).take(USER_EXPORT_MAX_ROWS).getMany()
    await this.attachDepts(users)
    await this.attachRoles(users)
    return users
  }

  /** 列表/导出共用的查询构造：过滤条件集中一处，避免导出和列表口径跑偏 */
  private buildListQuery(query: QueryUserDto): SelectQueryBuilder<UserEntity> {
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
    return qb
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

  /** 按 id 查找并带出角色及其授权的菜单/按钮（权限接口用，过滤已软删） */
  async findOneWithRolePermissions(id: string): Promise<UserEntity | null> {
    const user = await this.repository.findOne({
      where: { id, delFlag: 0 },
      relations: { roles: { permissions: true }, depts: true }
    })
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
      throw new BizException(BizErrorCode.BUSINESS_ERROR, '内置管理员账号不允许删除')
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
   * 导入用户（.xlsx / .csv 解析后的二维数组，第一行为表头）
   * - 按「登录账号」判定：不存在则新增（密码列留空用默认初始密码），已存在则只更新填了值的字段
   * - 部门/角色按名称匹配（角色也认编码），多个用 / , 、 ; 分隔；第一个部门即主部门
   * - 部门/角色写错直接判该行失败，不静默丢弃，避免「导入成功但权限没了」
   * - 单行失败不影响其他行，逐行统计返回
   */
  async importUsers(rows: string[][], headerRowNumber = 1, operator?: string): Promise<UserImportResult> {
    if (!rows.length) {
      throw new BadRequestException('文件内容为空，请下载模板后填写')
    }
    const { columns, dataRows } = this.resolveImportColumns(rows, headerRowNumber)
    if (columns.username === undefined) {
      throw new BadRequestException('未找到「登录账号」列，请使用导入模板的表头')
    }
    if (dataRows.length > USER_IMPORT_MAX_ROWS) {
      throw new BadRequestException(`单次最多导入 ${USER_IMPORT_MAX_ROWS} 行，当前 ${dataRows.length} 行，请拆分后重试`)
    }
    if (!dataRows.length) {
      throw new BadRequestException('表头下方没有数据行，请填写后再导入')
    }

    const [roles, depts, existingUsers, deletedUsers] = await Promise.all([
      this.roleRepository.find(),
      this.deptRepository.find({ where: { delFlag: '0' } }),
      this.repository.find({ where: { delFlag: 0 } }),
      this.repository.find({ where: { delFlag: 1 } })
    ])

    // 角色：名称与编码都能匹配（用户填哪个都行）
    const roleByKey = new Map<string, RoleEntity>()
    for (const role of roles) {
      roleByKey.set(role.roleCode.toLowerCase(), role)
      if (role.roleName) {
        roleByKey.set(role.roleName.toLowerCase(), role)
      }
    }
    // 部门：名称与 id 都能匹配
    const deptByKey = new Map<string, DeptEntity>()
    for (const dept of depts) {
      deptByKey.set(dept.id.toLowerCase(), dept)
      deptByKey.set(dept.departName.toLowerCase(), dept)
    }

    const userByName = new Map(existingUsers.map(user => [user.username.toLowerCase(), user]))
    const deletedNames = new Set(deletedUsers.map(user => user.username.toLowerCase()))
    const seenNames = new Set<string>()
    const result: UserImportResult = { total: dataRows.length, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] }

    /** 读取某列文本（列不存在时返回空串） */
    const pick = (cells: string[], field: UserImportField): string => {
      const index = columns[field]
      return index === undefined ? '' : (cells[index] ?? '').trim()
    }

    for (const { rowNumber, cells } of dataRows) {
      const username = pick(cells, 'username')
      const fail = (message: string) => {
        result.failed += 1
        result.errors.push({ row: rowNumber, username, message })
      }

      if (!username) {
        fail('登录账号不能为空')
        continue
      }
      if (!USERNAME_PATTERN.test(username)) {
        fail('登录账号需 3~100 位、以字母开头，只能包含字母/数字/下划线/点/横线/@')
        continue
      }
      const nameKey = username.toLowerCase()
      if (seenNames.has(nameKey)) {
        result.skipped += 1
        result.errors.push({ row: rowNumber, username, message: '文件内登录账号重复，本行已跳过' })
        continue
      }
      seenNames.add(nameKey)

      const realname = pick(cells, 'realname')
      if (!realname) {
        fail('真实姓名不能为空')
        continue
      }
      const password = pick(cells, 'password')
      if (password && (password.length < 6 || password.length > 64)) {
        fail('密码长度须在 6~64 位之间（留空表示新建时用初始密码、更新时保留原密码）')
        continue
      }

      const sexText = pick(cells, 'sex')
      const sex = sexText ? SEX_LABELS[sexText.toLowerCase()] : undefined
      if (sexText && sex === undefined) {
        fail('性别请填「男」或「女」')
        continue
      }
      const statusText = pick(cells, 'status')
      const status = statusText ? STATUS_LABELS[statusText.toLowerCase()] : undefined
      if (statusText && status === undefined) {
        fail('状态请填「正常」或「冻结」')
        continue
      }
      const birthdayText = pick(cells, 'birthday')
      const birthday = birthdayText ? normalizeDateText(birthdayText) : undefined
      if (birthdayText && !birthday) {
        fail(`生日「${birthdayText}」格式不正确，请用 1990-01-01 这种格式`)
        continue
      }

      // 部门：名称或 id，顺序即主次
      const deptNames = splitMultiValue(pick(cells, 'deptNames'))
      const deptIds: string[] | undefined = deptNames.length ? [] : undefined
      const missingDepts: string[] = []
      for (const name of deptNames) {
        const dept = deptByKey.get(name.toLowerCase())
        if (dept) {
          deptIds?.push(dept.id)
        } else {
          missingDepts.push(name)
        }
      }
      if (missingDepts.length) {
        fail(`部门不存在：${missingDepts.join('、')}（请填部门名称，或先到部门管理里创建）`)
        continue
      }

      // 角色：名称或编码
      const roleNames = splitMultiValue(pick(cells, 'roleNames'))
      const roleIds: string[] | undefined = roleNames.length ? [] : undefined
      const missingRoles: string[] = []
      for (const name of roleNames) {
        const role = roleByKey.get(name.toLowerCase())
        if (role) {
          roleIds?.push(role.id)
        } else {
          missingRoles.push(name)
        }
      }
      if (missingRoles.length) {
        fail(`角色不存在：${missingRoles.join('、')}（可填角色名称或角色编码）`)
        continue
      }

      const current = userByName.get(nameKey)
      try {
        if (current) {
          // 更新：只写填了值的字段，空单元格视为「不修改」
          await this.update(
            current.id,
            {
              realname,
              sex,
              birthday: birthday ?? undefined,
              status,
              password: password || undefined,
              phone: pick(cells, 'phone') || undefined,
              email: pick(cells, 'email') || undefined,
              workNo: pick(cells, 'workNo') || undefined,
              roleIds,
              deptIds
            },
            operator
          )
          result.updated += 1
        } else {
          if (deletedNames.has(nameKey)) {
            fail('该账号已被删除（软删除记录仍占用账号），请改用其他账号或先恢复原账号')
            continue
          }
          const created = await this.create(
            {
              username,
              realname,
              password: password || USER_IMPORT_DEFAULT_PASSWORD,
              sex,
              birthday: birthday ?? undefined,
              status: status ?? USER_STATUS.NORMAL,
              phone: pick(cells, 'phone') || undefined,
              email: pick(cells, 'email') || undefined,
              workNo: pick(cells, 'workNo') || undefined,
              roleIds,
              deptIds
            },
            operator
          )
          userByName.set(nameKey, created)
          result.created += 1
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : '写入失败')
      }
    }

    return result
  }

  /**
   * 解析导入列位置：按表头别名定位（忽略大小写与手写星号），第一行即表头
   * 行号取 Excel 真实行号，报错时用户能直接定位到文件里的第几行
   */
  private resolveImportColumns(
    rows: string[][],
    headerRowNumber: number
  ): { columns: Partial<Record<UserImportField, number>>; dataRows: Array<{ rowNumber: number; cells: string[] }> } {
    const header = rows[0].map(cell => cell.replace(/[\s*＊]/g, '').toLowerCase())
    const columns: Partial<Record<UserImportField, number>> = {}
    for (const field of Object.keys(USER_IMPORT_ALIASES) as UserImportField[]) {
      const index = header.findIndex(cell => USER_IMPORT_ALIASES[field].includes(cell))
      if (index >= 0) {
        columns[field] = index
      }
    }
    const dataRows = rows.slice(1).map((cells, index) => ({ rowNumber: headerRowNumber + index + 1, cells }))
    return { columns, dataRows }
  }

  /**
   * 去掉不允许客户端直接写入的字段
   * - depts / dept：关系字段与组装字段，非数据库列
   * - depart_ids / org_code：由 assignDepts 按主部门统一维护，避免两处写法互相覆盖
   */
  private stripUnwritableFields(data: Partial<UserEntity>): void {
    delete data.depts
    delete data.dept
    delete data.deptId
    delete data.departIds
    delete data.orgCode
  }

  /** 按 depart_ids 顺序整理部门，并把 depts[0] 同步到兼容字段 dept / deptId */
  private applyDepts(user: UserEntity): void {
    user.depts = this.orderDepts(user.depts ?? [], user.departIds)
    user.dept = user.depts[0] ?? null
    user.deptId = user.dept?.id ?? null
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
      user.deptId = user.dept?.id ?? null
    }
  }

  /** 批量补角色（列表/导出共用，只取 id/roleName/roleCode，避免带出菜单等大对象） */
  private async attachRoles(users: UserEntity[]): Promise<void> {
    if (!users.length) {
      return
    }
    const rows = await this.repository.find({
      where: { id: In(users.map(user => user.id)), delFlag: 0 },
      select: { id: true, roles: { id: true, roleName: true, roleCode: true } },
      relations: { roles: true }
    })
    const rolesByUser = new Map(rows.map(row => [row.id, row.roles ?? []]))
    for (const user of users) {
      user.roles = rolesByUser.get(user.id) ?? []
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
