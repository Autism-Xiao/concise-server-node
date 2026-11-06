import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Not, Repository, SelectQueryBuilder, type EntityManager, type FindOptionsWhere } from 'typeorm'

import { BizErrorCode } from '../../common/enums/biz-error-code.enum'
import { BizException } from '../../common/exceptions/biz.exception'
import { BaseService } from '../../helper/crud/base.service'
import { normalizeBatchIds, runBatchDelete, type BatchDeleteResult } from '../../helper/crud/batch-delete'
import { paginate, type PaginateOptions, type Pagination } from '../../helper/paginate'
import { RateLimitService } from '../../shared/rate-limit/rate-limit.service'
import { loginFailKeyOf } from '../../shared/rate-limit/login-fail.util'
import { OnlineService } from '../ops/online/online.service'
import { randomToken } from '../../utils/random-token.util'
import { describeDuplicateEntry, isDuplicateEntryError } from '../../utils/db-error.util'
import { encryptPassword, hashPassword, isArgon2Hash, randomId32, verifyArgon2Password } from '../../utils/password.util'
import { DeptEntity } from '../system/dept/entities/dept.entity'
import { UserWatermarkEntity } from '../system/watermark/entities/user-watermark.entity'
import { WatermarkSettingEntity } from '../system/watermark/entities/watermark-setting.entity'
import { FALLBACK_WATERMARK_SETTING, resolveWatermarkState } from '../system/watermark/watermark.util'
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

/** 唯一键字段：数据库对这三列建了唯一索引，写入前必须预检，否则用户只会看到 Duplicate entry SQL */
type UniqueField = 'phone' | 'email' | 'workNo'

/** 唯一键占用信息：谁占了这个值、该账号是否已被软删（软删不释放唯一索引） */
interface UniqueOwner {
  username: string
  deleted: boolean
}

/** 唯一键归一：去空格 + 小写，邮箱大小写不敏感，手机号/工号容忍用户手输首尾空格 */
function uniqueKey(value?: string | null): string {
  return (value ?? '').trim().toLowerCase()
}

/**
 * 把数据库写入异常翻译成业务中文
 * - 唯一键冲突（预检漏网：并发导入、软删账号占用等）不再把 SQL 抛给用户
 * - 其余异常保留原文，便于排查
 */
function describeWriteError(error: unknown): string {
  const duplicated = describeDuplicateEntry(error)
  if (duplicated) {
    return duplicated
  }
  return (error instanceof Error ? error.message : '') || '写入失败'
}

@Injectable()
export class UserService extends BaseService<UserEntity> {
  constructor(
    @InjectRepository(UserEntity)
    repository: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    @InjectRepository(DeptEntity)
    private readonly deptRepository: Repository<DeptEntity>,
    @InjectRepository(UserWatermarkEntity)
    private readonly userWatermarkRepository: Repository<UserWatermarkEntity>,
    @InjectRepository(WatermarkSettingEntity)
    private readonly watermarkSettingRepository: Repository<WatermarkSettingEntity>,
    private readonly rateLimitService: RateLimitService,
    private readonly onlineService: OnlineService
  ) {
    super(repository, '用户')
  }

  /** 创建：生成 32 位主键；密码统一用 argon2id 哈希（自带盐，不再写 sys_user.salt） */
  async create(dto: UserWriteInput, operator?: string): Promise<UserEntity> {
    const { roleIds, deptIds, deptId, ...rest } = dto
    const data: Partial<UserEntity> = { ...rest }
    this.stripUnwritableFields(data)
    // 唯一性预检：数据库唯一索引不区分软删除，必须提前给出可读提示（否则并发/软删占用会以 500 暴露）
    await this.assertUniqueFields(data)
    data.id = data.id || randomId32()
    if (data.password) {
      data.password = await hashPassword(data.password)
      data.salt = null
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
    const nextDeptIds = normalizeDeptIds(deptIds, deptId)

    // 主表 + 角色关联 + 部门关联必须同生共死：任一步失败整体回滚，不留「建好了但没权限」的半成品
    const id = await this.runInTransaction(async manager => {
      const repo = this.repoOf(manager)
      const user = await repo.save(repo.create(data))
      if (roleIds?.length) {
        await this.assignRoles(user.id, roleIds, manager)
      }
      if (nextDeptIds.length) {
        await this.assignDepts(user.id, nextDeptIds, manager)
      }
      return user.id
    })
    return this.findOneDetail(id) as Promise<UserEntity>
  }

  /** 更新：携带密码则用 argon2id 重新哈希；携带 roleIds / deptIds 则重绑关联 */
  async update(id: string, dto: UserWriteInput, operator?: string): Promise<UserEntity> {
    const { roleIds, deptIds, deptId, ...rest } = dto
    const data: Partial<UserEntity> = { ...rest }
    this.stripUnwritableFields(data)
    delete data.username // 账号不允许修改（改账号会让审计与历史密码哈希对不上）
    await this.findOne(id)
    await this.assertUniqueFields(data, id)
    if (data.password) {
      // argon2id 自带盐，顺手把历史 jeecg 盐清空，避免后续误按旧算法校验
      data.password = await hashPassword(data.password)
      data.salt = null
    }
    if (operator) {
      data.updateBy = operator
    }
    data.updateTime = new Date()
    // 传了 deptIds（含空数组）或旧字段 deptId 才重绑部门；都不传则保持原样
    const hasDeptChange = deptIds !== undefined || deptId !== undefined
    const nextDeptIds = normalizeDeptIds(deptIds, deptId)

    await this.runInTransaction(async manager => {
      await this.repoOf(manager).update(id, data)
      if (roleIds) {
        await this.assignRoles(id, roleIds, manager)
      }
      if (hasDeptChange) {
        await this.assignDepts(id, nextDeptIds, manager)
      }
    })
    return this.findOneDetail(id) as Promise<UserEntity>
  }

  /** 绑定角色（全量覆盖：多退少补） */
  async assignRoles(id: string, roleIds: string[], manager?: EntityManager): Promise<void> {
    // 独立接口直接调用时校验用户存在；事务内调用时由调用方（create/update）负责校验
    if (!manager) {
      await this.findOne(id)
    }
    const repo = this.repoOf(manager)
    const roles = await this.roleRepository.findBy({ id: In(roleIds) })
    const nextIds = new Set(roleIds)
    const current = await repo.createQueryBuilder().relation(UserEntity, 'roles').of(id).loadMany<RoleEntity>()
    const currentIds = new Set(current.map(role => role.id))
    // 只新增差集、删除差集，避免重复插入关联行
    const toAdd = roles.filter(role => !currentIds.has(role.id))
    const toRemove = current.filter(role => !nextIds.has(role.id))
    await repo.createQueryBuilder().relation(UserEntity, 'roles').of(id).addAndRemove(toAdd, toRemove)
  }

  /**
   * 绑定部门（全量覆盖，对齐 JeecgBoot sys_user_depart）
   * - 入参顺序即主次顺序，第一个为主部门
   * - 同步冗余：sys_user.depart_ids（逗号串）、sys_user.org_code（主部门机构编码）
   */
  async assignDepts(id: string, deptIds: string[], manager?: EntityManager): Promise<void> {
    if (!manager) {
      await this.findOne(id)
    }
    const repo = this.repoOf(manager)
    const ids = [...new Set(deptIds.filter(Boolean))]
    const depts = ids.length ? await this.deptRepository.find({ where: { id: In(ids), delFlag: '0' } }) : []
    if (depts.length !== ids.length) {
      const found = new Set(depts.map(dept => dept.id))
      throw new BizException(BizErrorCode.BUSINESS_ERROR, `部门不存在或已删除：${ids.filter(depId => !found.has(depId)).join(',')}`)
    }
    const deptMap = new Map(depts.map(dept => [dept.id, dept]))
    const ordered = ids.map(depId => deptMap.get(depId) as DeptEntity)

    const current = await repo.createQueryBuilder().relation(UserEntity, 'depts').of(id).loadMany<DeptEntity>()
    const currentIds = new Set(current.map(dept => dept.id))
    const toAdd = ordered.filter(dept => !currentIds.has(dept.id))
    const toRemove = current.filter(dept => !ids.includes(dept.id))
    if (toAdd.length || toRemove.length) {
      await repo.createQueryBuilder().relation(UserEntity, 'depts').of(id).addAndRemove(toAdd, toRemove)
    }

    await repo.update(id, {
      departIds: ids.length ? ids.join(',') : null,
      orgCode: ordered[0]?.orgCode ?? null,
      updateTime: new Date()
    })
  }

  /** 事务内使用的用户仓库（不传 manager 时走默认连接） */
  private repoOf(manager?: EntityManager): Repository<UserEntity> {
    return manager ? manager.getRepository(UserEntity) : this.repository
  }

  /**
   * 多步写在同一个事务里执行，并把唯一键冲突翻译成业务提示
   *
   * 为什么必须翻译：并发创建同名账号时前置查重必然漏网，MySQL 会抛 Duplicate entry，
   * 不处理就变成 500「服务器内部错误」，用户完全不知道该改什么。
   */
  private async runInTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.repository.manager.transaction(work)
    } catch (error) {
      if (isDuplicateEntryError(error)) {
        // 与角色/字典模块保持一致：唯一键冲突属于「参数问题」，用 400 而非 500
        throw new BadRequestException(describeDuplicateEntry(error) ?? '数据重复，请检查后重试')
      }
      throw error
    }
  }

  /**
   * 唯一性预检（对齐数据库唯一索引 sys_user.username / phone / email / work_no）
   * - 软删除记录**仍然占用**唯一索引，所以不加 del_flag 过滤，并在提示里说明怎么处理
   * - excludeId：更新时排除自己，否则「只改姓名」也会被判成冲突
   */
  private async assertUniqueFields(data: Partial<UserEntity>, excludeId?: string): Promise<void> {
    const rules: Array<{ field: 'username' | 'phone' | 'email' | 'workNo'; label: string }> = [
      { field: 'username', label: '登录账号' },
      { field: 'phone', label: '手机号' },
      { field: 'email', label: '邮箱' },
      { field: 'workNo', label: '工号' }
    ]
    for (const rule of rules) {
      // 账号创建后不可修改，更新时不需要校验
      if (rule.field === 'username' && excludeId) {
        continue
      }
      const raw = data[rule.field]
      const value = typeof raw === 'string' ? raw.trim() : ''
      if (!value) {
        continue
      }
      const where = { [rule.field]: value, ...(excludeId ? { id: Not(excludeId) } : {}) } as FindOptionsWhere<UserEntity>
      const existing = await this.repository.findOne({ where })
      if (!existing) {
        continue
      }
      if (rule.field === 'username') {
        throw new BadRequestException(
          existing.delFlag === 1
            ? `登录账号「${value}」已被一个已删除的账号占用（唯一索引不随软删除释放），请换一个账号或先恢复原账号`
            : `登录账号「${value}」已存在，请换一个`
        )
      }
      throw new BadRequestException(`${rule.label}「${value}」已被账号「${existing.username}」占用，请修改后再提交`)
    }
  }

  /** 分页列表：支持 keyword 模糊搜索账号/真实姓名/电话、status 精确过滤、部门过滤；过滤已软删 */
  async listByQuery(query: QueryUserDto): Promise<Pagination<UserEntity>> {
    const options: PaginateOptions = { page: query.page, pageSize: query.pageSize }
    const result = await paginate(this.buildListQuery(query), options)
    await this.attachDepts(result.records)
    await this.attachRoles(result.records)
    await this.attachWatermark(result.records)
    return result
  }

  /** 导出用户：与列表同过滤条件、不分页（上限 USER_EXPORT_MAX_ROWS），带部门与角色 */
  async exportUsers(query: QueryUserDto): Promise<UserEntity[]> {
    const users = await this.buildListQuery(query).take(USER_EXPORT_MAX_ROWS).getMany()
    await this.attachDepts(users)
    await this.attachRoles(users)
    await this.attachWatermark(users)
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
    await this.attachWatermark([user])
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
    await this.runInTransaction(async manager => {
      // 关联表必须跟着清：sys_user_role / sys_user_depart 不会随软删失效，
      // 不清会出现两个后果：① 角色删除保护把已删用户算成「还有 N 个用户」，角色永久删不掉；
      // ② 将来恢复账号时旧角色/旧部门「自动复活」，权限状态不可控。
      await manager.query('DELETE FROM sys_user_role WHERE user_id = ?', [id])
      await manager.query('DELETE FROM sys_user_depart WHERE user_id = ?', [id])
      // 水印个性化配置同样按 user_id 主键，不清会在表里越积越多
      await manager.query('DELETE FROM sys_user_watermark WHERE user_id = ?', [id])
      await this.repoOf(manager).update(id, { delFlag: 1, departIds: null, orgCode: null })
    })
  }

  /** 批量删除用户：逐条走 delete，保留「内置管理员不可删」的保护并收集原因 */
  async batchDelete(ids: string[]): Promise<BatchDeleteResult> {
    const targets = await this.repository.find({ where: { id: In(normalizeBatchIds(ids)), delFlag: 0 } })
    return runBatchDelete(
      targets,
      {
        getId: user => user.id,
        getName: user => user.realname || user.username,
        remove: user => this.delete(user.id)
      },
      ids
    )
  }

  /* ---------- 管理操作：重置密码 / 冻结 / 强制下线 / 解锁 / 回收站 ---------- */

  /**
   * 重置密码：管理端指定新密码，或留空生成 12 位易读随机口令
   * 明文只出现在本次返回值里（随响应一次性下发），库中只存 argon2id 哈希；
   * 重置后该用户全部在线会话立即失效（旧密码可能已泄露的假设下不能让旧登录态续命）
   */
  async resetPassword(id: string, plainPassword?: string): Promise<{ password: string }> {
    await this.findOne(id)
    const password = plainPassword?.trim() || randomToken(12)
    await this.updatePasswordOnly(id, password)
    await this.onlineService.kickUser(id)
    return { password }
  }

  /** 只改密码哈希（自助改密与重置密码共用）：argon2id 自带盐，顺手清历史 jeecg 盐 */
  async updatePasswordOnly(id: string, plainPassword: string): Promise<void> {
    await this.repository.update(id, { password: await hashPassword(plainPassword), salt: null, updateTime: new Date() })
  }

  /**
   * 冻结/解冻：1 正常 / 2 冻结
   * - 内置 admin 不允许冻结（没有其他管理员时会把整个系统锁死）
   * - 冻结时用户级拉黑 + 删除全部在线会话：JWT 每次请求会查库看到 status，但已签发的
     refreshToken 轮换不查库，必须靠黑名单立即掐断
   */
  async setStatus(id: string, status: number): Promise<{ status: number; kicked: number }> {
    const user = await this.findOne(id)
    if (user.username === 'admin' && status !== USER_STATUS.NORMAL) {
      throw new BizException(BizErrorCode.BUSINESS_ERROR, '内置管理员账号不允许冻结')
    }
    if (status !== USER_STATUS.NORMAL && status !== USER_STATUS.FROZEN) {
      throw new BizException(BizErrorCode.BUSINESS_ERROR, '状态只允许 1（正常）或 2（冻结）')
    }
    await this.repository.update(id, { status, updateTime: new Date() })
    const kicked = status === USER_STATUS.FROZEN ? await this.onlineService.kickUser(id) : 0
    return { status, kicked }
  }

  /** 管理员强制下线：踢掉该用户全部在线会话（自助改密走 AuthService，带 keepToken，不在这里） */
  async forceOffline(id: string): Promise<{ kicked: number }> {
    const user = await this.findOne(id)
    const kicked = await this.onlineService.kickUser(user.id)
    return { kicked }
  }

  /** 管理员解锁：清零登录失败计数（幂等） */
  async unlock(id: string): Promise<{ unlocked: true }> {
    const user = await this.findOne(id)
    await this.rateLimitService.reset(loginFailKeyOf(user.username))
    return { unlocked: true }
  }

  /** 回收站列表：del_flag=1 的软删用户，keyword 模糊搜账号/姓名/电话 */
  async listRecycled(query: QueryUserDto): Promise<Pagination<UserEntity>> {
    const qb = this.repository.createQueryBuilder('user').where('user.del_flag = 1').orderBy('user.update_time', 'DESC')
    if (query.keyword) {
      qb.andWhere('(user.username LIKE :keyword OR user.realname LIKE :keyword OR user.phone LIKE :keyword)', {
        keyword: `%${query.keyword}%`
      })
    }
    return paginate(qb, { page: query.page, pageSize: query.pageSize })
  }

  /**
   * 恢复软删用户：
   * - 软删时 sys_user_role / sys_user_depart / sys_user_watermark 已清空，账号恢复为「空壳」，
   *   可在本次请求里顺带重绑角色与部门（全量覆盖语义与 assignRoles/assignDepts 一致）
   * - 用户名若已被在用账号占用则拒绝（避免恢复出两个同名账号）
   */
  async restore(id: string, roleIds?: string[], deptIds?: string[]): Promise<UserEntity> {
    const recycled = await this.repository.findOne({ where: { id, delFlag: 1 } })
    if (!recycled) {
      throw new NotFoundException('回收站中没有该用户（可能已被恢复）')
    }
    const liveSameName = await this.repository.findOne({ where: { username: recycled.username, delFlag: 0 } })
    if (liveSameName && liveSameName.id !== id) {
      throw new BizException(BizErrorCode.BUSINESS_ERROR, `用户名 ${recycled.username} 已被其他在用账号占用，无法恢复`)
    }
    await this.runInTransaction(async manager => {
      await this.repoOf(manager).update(id, { delFlag: 0, status: USER_STATUS.NORMAL, updateTime: new Date() })
      if (roleIds) {
        await this.assignRoles(id, roleIds, manager)
      }
      if (deptIds) {
        await this.assignDepts(id, deptIds, manager)
      }
    })
    // 回收站里的行是裸查出来的（无关联），重查一次补齐角色/部门
    await this.attachRoles([recycled])
    await this.attachDepts([recycled])
    recycled.delFlag = 0
    recycled.status = USER_STATUS.NORMAL
    return recycled
  }

  /**
   * 校验登录密码
   * - 新格式（$argon2id$...）：argon2id 比对
   * - 旧格式（JeecgBoot 16/32/48 位十六进制）：复算 PBEWithMD5AndDES 比对，
   *   登录成功后由 upgradePasswordHash 透明升级，无需批量刷库
   */
  async verifyPassword(user: UserEntity, plainPassword: string): Promise<boolean> {
    if (!user.password) {
      return false
    }
    if (isArgon2Hash(user.password)) {
      return verifyArgon2Password(user.password, plainPassword)
    }
    if (!user.salt) {
      return false
    }
    return encryptPassword(user.username, plainPassword, user.salt) === user.password
  }

  /**
   * 把旧算法的密码就地升级为 argon2id（登录成功时调用）
   * 只改 password / salt，不动 update_time —— 用户并没有「修改」账号信息。
   * 失败不影响本次登录，下次登录会再试一次。
   */
  async upgradePasswordHash(id: string, plainPassword: string): Promise<boolean> {
    try {
      const hashed = await hashPassword(plainPassword)
      await this.repository.update(id, { password: hashed, salt: null })
      return true
    } catch {
      return false
    }
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

    // 手机号/邮箱/工号在库内唯一（唯一索引不区分软删除），先建占用表做预检
    const owners: Record<UniqueField, Map<string, UniqueOwner>> = { phone: new Map(), email: new Map(), workNo: new Map() }
    /** 账号 → 当前占用的唯一键值，更新换绑时用来释放旧值，避免同一份文件里互相误判 */
    const ownedValues: Record<UniqueField, Map<string, string>> = { phone: new Map(), email: new Map(), workNo: new Map() }
    for (const user of [...existingUsers, ...deletedUsers]) {
      const owner: UniqueOwner = { username: user.username, deleted: user.delFlag === 1 }
      const nameKey = user.username.toLowerCase()
      for (const field of ['phone', 'email', 'workNo'] as UniqueField[]) {
        const key = uniqueKey(user[field])
        if (!key) {
          continue
        }
        owners[field].set(key, owner)
        ownedValues[field].set(nameKey, key)
      }
    }

    /** 该值是否被「别人」占用（自己覆盖自己不算冲突） */
    const findConflict = (field: UniqueField, label: string, raw: string, selfName: string): string | null => {
      const key = uniqueKey(raw)
      if (!key) {
        return null
      }
      const owner = owners[field].get(key)
      if (!owner || owner.username.toLowerCase() === selfName) {
        return null
      }
      return `${label}「${raw.trim()}」已被账号「${owner.username}」占用${owner.deleted ? '（该账号已删除，但唯一索引仍占用，请先恢复原账号或换一个）' : ''}`
    }

    /** 写入成功后同步占用表：先释放本账号旧值，再登记新值 */
    const syncOwner = (field: UniqueField, raw: string, selfName: string, username: string): void => {
      const previous = ownedValues[field].get(selfName)
      if (previous && owners[field].get(previous)?.username.toLowerCase() === selfName) {
        owners[field].delete(previous)
        ownedValues[field].delete(selfName)
      }
      const key = uniqueKey(raw)
      if (key) {
        owners[field].set(key, { username, deleted: false })
        ownedValues[field].set(selfName, key)
      }
    }

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

      const phone = pick(cells, 'phone')
      const email = pick(cells, 'email')
      const workNo = pick(cells, 'workNo')
      // 唯一键预检：跟「别的账号」冲突才拦，自己覆盖自己的值放行
      const uniqueConflict =
        findConflict('phone', '手机号', phone, nameKey) ?? findConflict('email', '邮箱', email, nameKey) ?? findConflict('workNo', '工号', workNo, nameKey)
      if (uniqueConflict) {
        fail(uniqueConflict)
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
              phone: phone || undefined,
              email: email || undefined,
              workNo: workNo || undefined,
              roleIds,
              deptIds
            },
            operator
          )
          syncOwner('phone', phone, nameKey, current.username)
          syncOwner('email', email, nameKey, current.username)
          syncOwner('workNo', workNo, nameKey, current.username)
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
              phone: phone || undefined,
              email: email || undefined,
              workNo: workNo || undefined,
              roleIds,
              deptIds
            },
            operator
          )
          userByName.set(nameKey, created)
          syncOwner('phone', phone, nameKey, username)
          syncOwner('email', email, nameKey, username)
          syncOwner('workNo', workNo, nameKey, username)
          result.created += 1
        }
      } catch (error) {
        fail(describeWriteError(error))
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

  /**
   * 批量补水印状态（列表/导出/详情共用）
   *
   * 一次查全局配置 + 一次查用户覆盖，再走 resolveWatermarkState 统一算生效结果；
   * 刻意不在循环里逐条 findOne —— 200 个用户就是 200 次 SQL。
   */
  private async attachWatermark(users: UserEntity[]): Promise<void> {
    if (!users.length) {
      return
    }
    const [settingRow, rows] = await Promise.all([
      this.watermarkSettingRepository.findOne({ where: { id: 1 } }),
      this.userWatermarkRepository.find({ where: { userId: In(users.map(user => user.id)) } })
    ])
    const setting = settingRow
      ? {
          enabled: Number(settingRow.enabled),
          mode: settingRow.mode,
          content: settingRow.content,
          density: settingRow.density,
          opacity: Number(settingRow.opacity),
          rotate: Number(settingRow.rotate),
          fontSize: Number(settingRow.fontSize)
        }
      : FALLBACK_WATERMARK_SETTING
    const customByUser = new Map(rows.map(row => [row.userId, row]))
    for (const user of users) {
      const custom = customByUser.get(user.id)
      user.watermarkEnabled = custom?.enabled ?? null
      user.watermarkEnforced = custom?.enforced ?? 0
      user.watermarkEffective = resolveWatermarkState(setting, custom).enabled
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
