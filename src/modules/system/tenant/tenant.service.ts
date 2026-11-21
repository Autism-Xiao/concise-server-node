import { BadRequestException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { Brackets, DataSource, Repository } from 'typeorm'

import { Pagination } from '../../../helper/paginate/pagination'
import { applySort } from '../../../helper/paginate/sort'
import { BizErrorCode } from '../../../common/enums/biz-error-code.enum'
import { BizException } from '../../../common/exceptions/biz.exception'
import { PermissionCacheService } from '../../../shared/permission-cache/permission-cache.service'
import { AuthUserCacheService } from '../../../shared/auth-cache/auth-user-cache.service'
import { TenantAccessService } from '../../../shared/tenant/tenant-access.service'
import { TenantContext } from '../../../shared/tenant/tenant.context'
import { isDuplicateEntryError } from '../../../utils/db-error.util'
import { randomId32 } from '../../../utils/password.util'
import { SystemConfigService } from '../config/system-config.service'
import { UserService } from '../../user/user.service'
import { UserEntity } from '../../user/entities/user.entity'
import { ApplyTenantDto } from './dto/apply-tenant.dto'
import { CreateTenantAdminDto } from './dto/create-tenant-admin.dto'
import { CreateTenantDto } from './dto/create-tenant.dto'
import { QueryTenantDto } from './dto/query-tenant.dto'
import { QueryTenantUserDto } from './dto/tenant-user.dto'
import { UpdateTenantDto } from './dto/update-tenant.dto'
import { TenantEntity } from './entities/tenant.entity'
import { UserTenantEntity } from './entities/user-tenant.entity'
import { TenantProvisionService } from './tenant-provision.service'
import { LogService } from '../log/log.service'
import { QuotaService } from '../../../shared/quota/quota.service'

/** 租户下的用户（只暴露安全字段，密码/盐不出现在这里） */
export interface TenantUserItem {
  id: string
  username: string
  realname: string
  status: number
  joinTime: Date | null
}

/** 自助开通资格（前端「开通我的团队」入口据此决定显示表单还是升级提示） */
export interface TenantApplyQuota {
  /** 是否有有效 VIP 资格（平台管理员恒为 true） */
  isVip: boolean
  /** VIP 到期时间（ISO；null = 永久） */
  vipExpireAt: string | null
  /** 已（自己）开通且未删除的租户数 */
  ownedCount: number
  /** 可开通上限；-1 = 不限制（平台管理员） */
  maxTenants: number
  canApply: boolean
  /** '' | 'NEED_VIP' | 'QUOTA_EXCEEDED'，前端按它切文案 */
  reason: '' | 'NEED_VIP' | 'QUOTA_EXCEEDED'
}

/** 可排序字段白名单：前端列 id → 实体属性名 */
const TENANT_SORTABLE: Record<string, string> = {
  name: 'name',
  code: 'code',
  status: 'status',
  createTime: 'createTime'
}

@Injectable()
export class TenantService {
  constructor(
    @InjectRepository(TenantEntity)
    private readonly repository: Repository<TenantEntity>,
    @InjectRepository(UserTenantEntity)
    private readonly userTenantRepository: Repository<UserTenantEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantAccess: TenantAccessService,
    private readonly provision: TenantProvisionService,
    private readonly permissionCache: PermissionCacheService,
    private readonly authUserCache: AuthUserCacheService,
    private readonly config: SystemConfigService,
    private readonly userService: UserService,
    private readonly logService: LogService,
    private readonly quota: QuotaService
  ) {}

  /** 分页列表（租户是平台级数据，不参与租户隔离） */
  async list(query: QueryTenantDto): Promise<Pagination<TenantEntity>> {
    // page/pageSize 是统一参数；current/size 是旧名兼容（见 QueryTenantDto）
    const page = query.page ?? query.current ?? 1
    const size = query.pageSize ?? query.size ?? 10
    const qb = this.repository.createQueryBuilder('t').where('t.del_flag = 0')

    const keyword = query.keyword?.trim()
    if (keyword) {
      qb.andWhere(
        new Brackets(sub => {
          sub
            .where('t.name LIKE :keyword', { keyword: `%${keyword}%` })
            .orWhere('t.code LIKE :keyword', { keyword: `%${keyword}%` })
            .orWhere('t.contact LIKE :keyword', { keyword: `%${keyword}%` })
        })
      )
    }
    if (query.status !== undefined) {
      qb.andWhere('t.status = :status', { status: query.status })
    }

    // 带出每个租户的人数，列表页不用再逐个请求；排序列走白名单
    qb.orderBy('t.id', 'ASC')
    applySort(qb, 't', query, TENANT_SORTABLE)
    qb.skip((page - 1) * size).take(size)
    const [records, total] = await qb.getManyAndCount()

    const counts = await this.countUsers(records.map(item => item.id))
    const withCount = records.map(item => Object.assign(item, { userCount: counts.get(item.id) ?? 0 })) as (TenantEntity & { userCount: number })[]
    return new Pagination(withCount, total, page, size)
  }

  async findOne(id: number): Promise<TenantEntity> {
    const tenant = await this.repository.findOne({ where: { id, delFlag: 0 } })
    if (!tenant) throw new NotFoundException('租户不存在')
    return tenant
  }

  /**
   * 新建租户
   *
   * 租户落库与「默认角色初始化」放在同一个事务：只建出 sys_tenant 而没建角色的空壳租户，
   * 管理员进去会发现侧边栏一片空白、每个按钮都 403，排查成本远高于直接让创建失败。
   */
  async create(dto: CreateTenantDto, operator?: string): Promise<TenantEntity> {
    await this.assertCodeAvailable(dto.code)
    const entity = this.repository.create({
      ...dto,
      plan: dto.plan ?? 'standard',
      status: dto.status ?? 0,
      delFlag: 0,
      contact: dto.contact ?? '',
      phone: dto.phone ?? '',
      remark: dto.remark ?? '',
      createBy: operator ?? null,
      createTime: new Date()
    })
    try {
      return await this.dataSource.transaction(async manager => {
        const tenant = await manager.getRepository(TenantEntity).save(entity)
        await this.provision.provisionIn(manager, tenant.id, operator)
        return tenant
      })
    } catch (error) {
      if (isDuplicateEntryError(error)) {
        throw new BizException(BizErrorCode.TENANT_CODE_CONFLICT, `租户编码「${dto.code}」已存在`, HttpStatus.BAD_REQUEST)
      }
      throw error
    }
  }

  /**
   * 自助开通资格：VIP 状态 + 已开租户数 + 上限
   *
   * VIP 落在账号上（sys_user.vip_level / vip_expire_at）——开通租户时租户还不存在。
   * 平台管理员不受限（本来就能在租户管理里直接建）。
   */
  async applyQuota(userId: string): Promise<TenantApplyQuota> {
    const rows = await this.dataSource.query<Array<{ vipLevel: number; vipExpireAt: Date | null; isPlatformAdmin: number }>>(
      'SELECT vip_level AS vipLevel, vip_expire_at AS vipExpireAt, is_platform_admin AS isPlatformAdmin FROM sys_user WHERE id = ? AND del_flag = 0',
      [userId]
    )
    if (!rows.length) throw new NotFoundException('用户不存在')
    const vipExpireAt = rows[0].vipExpireAt ? new Date(rows[0].vipExpireAt) : null
    const isSuper = Number(rows[0].isPlatformAdmin) === 1
    const vipActive = Number(rows[0].vipLevel) === 1 && (!vipExpireAt || vipExpireAt.getTime() > Date.now())
    const isVip = isSuper || vipActive
    const maxTenants = isSuper ? -1 : await this.config.getNumber('tenant.vip.maxTenants', 1)
    // 只数「自己开通的团队」：被邀请加入别人的租户不占额度（平台代开的 owner 为 NULL，也不占）
    const counted = await this.dataSource.query<Array<{ c: number }>>('SELECT COUNT(*) AS c FROM sys_tenant WHERE owner_user_id = ? AND del_flag = 0', [userId])
    const ownedCount = Number(counted[0]?.c ?? 0)
    const canApply = isVip && (maxTenants < 0 || ownedCount < maxTenants)
    const reason: TenantApplyQuota['reason'] = canApply ? '' : isVip ? 'QUOTA_EXCEEDED' : 'NEED_VIP'
    return {
      isVip,
      vipExpireAt: vipExpireAt ? vipExpireAt.toISOString() : null,
      ownedCount,
      maxTenants,
      canApply,
      reason
    }
  }

  /**
   * 自助开通租户（登录用户 → 成为该租户管理员）
   *
   * 事务里一次做完：建租户 → 初始化默认角色 → 当前用户入租户 + 绑 admin → 记住为登录租户。
   * 任何一步失败整体回滚，不会留下「建了租户却进不去」的空壳。
   */
  async applyCreate(userId: string, dto: ApplyTenantDto, operator?: string): Promise<TenantEntity> {
    const quota = await this.applyQuota(userId)
    if (!quota.isVip) {
      throw new BizException(BizErrorCode.TENANT_APPLY_NEED_VIP, '开通租户需要 VIP 资格，请联系平台开通', HttpStatus.FORBIDDEN)
    }
    if (!quota.canApply) {
      throw new BizException(BizErrorCode.TENANT_APPLY_QUOTA, `最多可开通 ${quota.maxTenants} 个租户，已达上限，请联系平台提升额度`, HttpStatus.BAD_REQUEST)
    }
    await this.assertCodeAvailable(dto.code)
    const entity = this.repository.create({
      name: dto.name,
      code: dto.code,
      // 记录开通人：VIP 额度按「自己开的团队」统计，被邀请加入的租户不算
      ownerUserId: userId,
      contact: dto.contact ?? '',
      phone: dto.phone ?? '',
      plan: 'standard',
      status: 0,
      remark: dto.remark ?? '',
      delFlag: 0,
      createBy: operator ?? null,
      createTime: new Date()
    })
    let tenant: TenantEntity
    try {
      tenant = await this.dataSource.transaction(async manager => {
        // 配额的真实判定放在事务内：外面 applyQuota 只是给前端快速反馈，
        // 并发两次「开通」都可能通过外部检查。锁住申请人这一行，把同一用户的并发开通串行化。
        await manager.query('SELECT id FROM sys_user WHERE id = ? FOR UPDATE', [userId])
        if (quota.maxTenants >= 0) {
          const countRows = await manager.query<Array<{ c: number | string }>>(
            'SELECT COUNT(*) AS c FROM sys_tenant WHERE owner_user_id = ? AND del_flag = 0',
            [userId]
          )
          if (Number(countRows[0]?.c ?? 0) >= quota.maxTenants) {
            throw new BizException(
              BizErrorCode.TENANT_APPLY_QUOTA,
              `最多可开通 ${quota.maxTenants} 个租户，已达上限，请联系平台提升额度`,
              HttpStatus.BAD_REQUEST
            )
          }
        }
        const saved = await manager.getRepository(TenantEntity).save(entity)
        await this.provision.provisionIn(manager, saved.id, operator)
        const roles = await manager.query<Array<{ id: string }>>('SELECT id FROM sys_role WHERE tenant_id = ? AND role_code = ? LIMIT 1', [saved.id, 'admin'])
        const adminRoleId = roles[0]?.id
        if (!adminRoleId) {
          throw new BizException(BizErrorCode.TENANT_NO_ADMIN_TEMPLATE, '租户默认角色初始化失败，请稍后重试', HttpStatus.INTERNAL_SERVER_ERROR)
        }
        await manager.query('INSERT INTO sys_user_tenant (user_id, tenant_id, status, create_time) VALUES (?, ?, 0, NOW())', [userId, saved.id])
        // tenant_id 与 UserService.assignRoles 保持一致，避免同一张表一半有归属一半是 0
        await manager.query('INSERT IGNORE INTO sys_user_role (id, user_id, role_id, tenant_id) VALUES (?, ?, ?, ?)', [
          randomId32(),
          userId,
          adminRoleId,
          saved.id
        ])
        // 派生租户管理员标志位：自助开通人自动成为该租户管理员
        await this.userService.syncTenantAdminFlag(userId, manager)
        await manager.query('UPDATE sys_user SET login_tenant_id = ?, update_time = NOW() WHERE id = ?', [saved.id, userId])
        return saved
      })
    } catch (error) {
      if (isDuplicateEntryError(error)) {
        throw new BizException(BizErrorCode.TENANT_CODE_CONFLICT, `租户编码「${dto.code}」已存在`, HttpStatus.BAD_REQUEST)
      }
      throw error
    }
    // 新增了角色授权 + 用户归属：权限集合、用户态、租户归属缓存都要失效。
    // 少了 authUserCache 这一条，新管理员在 30s 内仍是不带 admin 角色的旧快照，进新租户处处 403。
    await this.permissionCache.invalidateAll()
    this.authUserCache.invalidate(userId)
    this.tenantAccess.invalidate(userId)
    return tenant
  }

  async update(id: number, dto: UpdateTenantDto, operator?: string): Promise<TenantEntity> {
    await this.findOne(id)
    if (dto.code) await this.assertCodeAvailable(dto.code, id)

    const patch: Record<string, unknown> = { ...dto, updateBy: operator ?? null, updateTime: new Date() }
    // 空字符串统一存 null，避免 date 列收到 '' 报错
    if (dto.expireAt === ('' as never)) patch.expireAt = null
    if (dto.beginDate === ('' as never)) patch.beginDate = null

    try {
      await this.repository.createQueryBuilder().update(TenantEntity).set(patch).where('id = :id', { id }).execute()
    } catch (error) {
      if (isDuplicateEntryError(error)) {
        throw new BizException(BizErrorCode.TENANT_CODE_CONFLICT, `租户编码「${dto.code}」已存在`, HttpStatus.BAD_REQUEST)
      }
      throw error
    }
    // 改了状态/到期日会影响归属校验结果
    this.tenantAccess.invalidate()
    return this.findOne(id)
  }

  /**
   * 删除：软删租户 + 物理删该租户的角色
   *
   * 租户下还有用户时拒绝，避免一键让整租户的账号没有归属。
   * 角色必须跟着删干净：sys_role 没有 del_flag，留着不只是垃圾行，
   * 还会一直占着 (tenant_id, role_code) 唯一键，日后同 id 重建租户就插不进去。
   */
  async remove(id: number): Promise<void> {
    if (id === 1) {
      throw new BadRequestException('默认租户不允许删除')
    }
    await this.findOne(id)
    // 人数只算未删除用户：软删用户原本会永久占着名额，而用户列表里又看不到他们
    const userRows = await this.dataSource.query<Array<{ c: number | string }>>(
      `SELECT COUNT(*) AS c
         FROM sys_user_tenant ut
         JOIN sys_user u ON u.id = ut.user_id
        WHERE ut.tenant_id = ? AND ut.status = 0 AND u.del_flag = 0`,
      [id]
    )
    const userCount = Number(userRows[0]?.c ?? 0)
    if (userCount > 0) {
      throw new BadRequestException(`该租户下还有 ${userCount} 个用户，请先在「分配用户」里移除后再删除`)
    }
    await this.dataSource.transaction(async manager => {
      await manager.update(TenantEntity, id, { delFlag: 1, updateTime: new Date() })
      // 先删授权/角色绑定再删角色（无外键，顺序反了不会报错但会留下孤儿行）
      const roles = await manager.query<Array<{ id: string }>>('SELECT id FROM sys_role WHERE tenant_id = ?', [id])
      if (roles.length > 0) {
        const ids = roles.map(role => role.id)
        const placeholders = ids.map(() => '?').join(',')
        await manager.query(`DELETE FROM sys_user_role WHERE role_id IN (${placeholders})`, ids)
        await manager.query(`DELETE FROM sys_role_permission WHERE role_id IN (${placeholders})`, ids)
        await manager.query(`DELETE FROM sys_role WHERE id IN (${placeholders})`, ids)
      }
      // 套餐、成员关系、默认登录租户都是租户生命周期的一部分，不能留给孤儿行
      await manager.query('DELETE FROM sys_tenant_menu WHERE tenant_id = ?', [id])
      await manager.query('DELETE FROM sys_user_tenant WHERE tenant_id = ?', [id])
      await manager.query('UPDATE sys_user SET login_tenant_id = NULL WHERE login_tenant_id = ?', [id])
    })
    // 角色授权/成员关系都变了：权限集合、用户态、租户归属缓存必须整体失效
    await this.permissionCache.invalidateAll()
    this.authUserCache.invalidateAll()
    this.tenantAccess.invalidate()
  }

  /**
   * 为租户建一个管理员账号
   *
   * 为什么需要单独一个接口：用户名**全局唯一**，不能每个租户都叫 admin；
   * 而平台管理员在「用户管理」里建号时，平台视角会被 `resolveJoinTenantId()` 兜底到默认租户 1 ——
   * 想建到别的租户必须先切租户，稍不注意就建错地方。这里把
   * 「建号 + 加入本租户 + 绑本租户 admin 角色」做成一步。
   *
   * 角色固定绑 `role_code='admin'`，调用方不必传角色，也就没有传错角色的口子。
   */
  async createAdmin(tenantId: number, dto: CreateTenantAdminDto, operator?: string): Promise<UserEntity> {
    await this.findOne(tenantId)
    const rows = await this.dataSource.query<Array<{ id: string }>>('SELECT id FROM sys_role WHERE tenant_id = ? AND role_code = ? LIMIT 1', [
      tenantId,
      'admin'
    ])
    const adminRoleId = rows[0]?.id
    if (!adminRoleId) {
      throw new BizException(BizErrorCode.TENANT_NO_ADMIN_TEMPLATE, '该租户还没有内置 admin 角色，请先执行「同步全部角色」', HttpStatus.BAD_REQUEST)
    }
    // 用租户上下文包一层：UserService.create 会把新账号加入「当前租户」，
    // 否则平台视角下建号会落到默认租户 1
    return TenantContext.withTenant(tenantId, () =>
      this.userService.create(
        {
          username: dto.username,
          realname: dto.realname,
          password: dto.password,
          status: dto.status ?? 1,
          roleIds: [adminRoleId]
        },
        operator
      )
    )
  }

  /**
   *
   * 超管走平台视角，可以看到全部租户并随意切进去排查问题；
   * 普通用户只列自己 sys_user_tenant 里的那些。
   */
  async mine(userId: string): Promise<{
    current: number | null
    isSuper: boolean
    isTenantAdmin: boolean
    tenants: { id: number; name: string; code: string; status: number; expireAt: string | null; usable: boolean }[]
  }> {
    const membership = await this.tenantAccess.loadMembership(userId)
    // 「当前生效租户」必须取中间件按 X-Tenant-Id 解析好的上下文。
    // 这里再调一次 resolveTenant(userId) 是拿不到请求头的：超管会一律算成「平台视角」，
    // 前端切换器于是永远显示「平台视角」并把该菜单项置灰 —— 表现就是「点了没反应」。
    const store = TenantContext.get()
    const current = store ? store.tenantId : (await this.tenantAccess.resolveTenant(userId)).tenantId
    const source = membership.isSuper ? await this.listAllTenants() : membership.tenants
    return {
      current,
      isSuper: membership.isSuper,
      isTenantAdmin: membership.isTenantAdmin,
      tenants: source.map(item => ({
        id: item.id,
        name: item.name,
        code: item.code,
        status: item.status,
        expireAt: item.expireAt,
        usable: this.tenantAccess.isUsable(item)
      }))
    }
  }

  /** 全部租户（仅超管切换器使用） */
  private async listAllTenants(): Promise<{ id: number; name: string; code: string; status: number; expireAt: string | null }[]> {
    const rows = await this.dataSource.query<{ id: number; name: string; code: string; status: number; expireAt: string | null }[]>(
      `SELECT id, name, code, status, DATE_FORMAT(expire_at, '%Y-%m-%d') AS expireAt
         FROM sys_tenant WHERE del_flag = 0 ORDER BY id`
    )
    return rows.map(row => ({ ...row, id: Number(row.id), status: Number(row.status) }))
  }

  /**
   * 切换当前租户：校验归属后记住选择，后续请求由请求头生效
   *
   * 代维审计：切换动作写 sys_log（operateType=3）。平台管理员切进任意租户属于「代维」，
   * 切到平台视角（0）则记录为 tenant_id=0 的平台级日志，仅平台管理员可见。
   */
  async switch(userId: string, tenantId: number, username?: string): Promise<{ tenantId: number | null }> {
    // 0 = 回到平台视角（不过滤），只对超管开放
    if (tenantId <= 0) {
      const membership = await this.tenantAccess.loadMembership(userId)
      if (!membership.isSuper) {
        throw new BadRequestException('只有平台管理员可以切换到平台视角')
      }
      await this.dataSource.query('UPDATE sys_user SET login_tenant_id = NULL WHERE id = ?', [userId])
      await this.logService.recordOper({
        userId,
        username,
        module: '租户管理',
        action: `切换租户 → 平台视角（不过滤，可看全部租户数据）`,
        operateType: 3,
        ip: '-',
        tenantId: 0,
        status: 0,
        elapsed: 0
      })
      return { tenantId: null }
    }
    const resolved = await this.tenantAccess.resolveTenant(userId, tenantId)
    // 记住选择，下次不带请求头时用它做默认
    await this.dataSource.query('UPDATE sys_user SET login_tenant_id = ? WHERE id = ?', [tenantId, userId])
    await this.logService.recordOper({
      userId,
      username,
      module: '租户管理',
      action: `切换租户 → #${tenantId}${resolved.tenantId === tenantId ? '' : `（解析为 #${resolved.tenantId}）`}`,
      operateType: 3,
      ip: '-',
      tenantId: resolved.tenantId ?? 0,
      // 必须显式传：这条日志是在**切换前**的上下文里写的，从平台视角切入租户时
      // TenantContext.isProxy() 还是 false（tenantId 仍为 null），靠它推导会漏掉代维标记
      isProxy: resolved.membership?.isSuper ? 1 : 0,
      status: 0,
      elapsed: 0
    })
    return { tenantId: resolved.tenantId }
  }

  /** 租户下的用户（分页） */
  async listUsers(tenantId: number, query: QueryTenantUserDto): Promise<Pagination<TenantUserItem>> {
    await this.findOne(tenantId)
    const page = query.current ?? 1
    const size = query.size ?? 10

    const qb = this.dataSource
      .createQueryBuilder()
      .select('u.id', 'id')
      .addSelect('u.username', 'username')
      .addSelect('u.realname', 'realname')
      .addSelect('u.status', 'status')
      .addSelect('ut.create_time', 'joinTime')
      .from('sys_user', 'u')
      .innerJoin(UserTenantEntity, 'ut', 'ut.user_id = u.id AND ut.tenant_id = :tenantId', { tenantId })
      .where('u.del_flag = 0')

    const keyword = query.keyword?.trim()
    if (keyword) {
      qb.andWhere(
        new Brackets(sub => sub.where('u.username LIKE :keyword', { keyword: `%${keyword}%` }).orWhere('u.realname LIKE :keyword', { keyword: `%${keyword}%` }))
      )
    }
    qb.orderBy('u.create_time', 'DESC')

    const total = await qb.getCount()
    const rows = await qb
      .offset((page - 1) * size)
      .limit(size)
      .getRawMany<TenantUserItem>()
    return new Pagination(rows, total, page, size)
  }

  /**
   * 覆盖式分配：以传入列表为最终结果，多退少补
   *
   * 事务内一律用 manager，避免默认连接看不到未提交的数据（项目既有约定）。
   * 移除用户时同步清掉他的 login_tenant_id，否则下次请求会指向一个已不归属的租户。
   */
  async assignUsers(tenantId: number, userIds: string[]): Promise<{ added: number; removed: number }> {
    await this.findOne(tenantId)
    const targetIds = [...new Set(userIds.filter(Boolean))]

    let removedUserIds: string[] = []
    const result = await this.dataSource.transaction(async manager => {
      const current = await manager.find(UserTenantEntity, { where: { tenantId } })
      const currentIds = new Set(current.map(item => item.userId))
      const targetSet = new Set(targetIds)

      const removeRows = current.filter(item => !targetSet.has(item.userId))
      const addIds = targetIds.filter(id => !currentIds.has(id))
      removedUserIds = removeRows.map(item => item.userId)
      // 配额按「实际新增」计算：覆盖式分配里已存在的成员不重复占额
      await this.quota.assertUserQuota(tenantId, addIds.length)

      if (removeRows.length) {
        const userPlaceholders = removeRows.map(() => '?').join(',')
        const removedIds = removeRows.map(item => item.userId)
        // 兜底：不能把本租户最后一个管理员移除，否则租户再无人可管（只有平台超管能代维）
        const adminRows = await manager.query<Array<{ user_id: string }>>(
          `SELECT ur.user_id
             FROM sys_user_role ur
             JOIN sys_role r ON r.id = ur.role_id
            WHERE r.tenant_id = ? AND r.role_code = 'admin' AND ur.user_id IN (${userPlaceholders})`,
          [tenantId, ...removedIds]
        )
        if (adminRows.length) {
          const remainRows = await manager.query<Array<{ c: number | string }>>(
            `SELECT COUNT(*) AS c
               FROM sys_user_role ur
               JOIN sys_role r ON r.id = ur.role_id
               JOIN sys_user_tenant ut ON ut.user_id = ur.user_id AND ut.tenant_id = r.tenant_id AND ut.status = 0
              WHERE r.tenant_id = ? AND r.role_code = 'admin' AND ur.user_id NOT IN (${userPlaceholders})`,
            [tenantId, ...removedIds]
          )
          if (Number(remainRows[0]?.c ?? 0) === 0) {
            throw new BadRequestException('该用户是本租户最后一个管理员，请先指定其他管理员后再移除')
          }
        }

        await manager.delete(
          UserTenantEntity,
          removeRows.map(item => item.id)
        )
        // 只删该用户在本租户角色上的绑定；他可能同时属于别的租户，别把别处角色一起清掉
        await manager.query(
          `DELETE ur FROM sys_user_role ur
             INNER JOIN sys_role r ON r.id = ur.role_id
            WHERE r.tenant_id = ? AND ur.user_id IN (${userPlaceholders})`,
          [tenantId, ...removedIds]
        )
        // 角色绑定变了：重新派生这些用户的 is_tenant_admin（可能还管着别的租户）
        for (const userId of removedIds) {
          await this.userService.syncTenantAdminFlag(userId, manager)
        }
        await manager.query(`UPDATE sys_user SET login_tenant_id = NULL WHERE login_tenant_id = ? AND id IN (${userPlaceholders})`, [
          tenantId,
          ...removeRows.map(item => item.userId)
        ])
      }
      if (addIds.length) {
        await manager.insert(
          UserTenantEntity,
          addIds.map(userId => ({ userId, tenantId, status: 0, createTime: new Date() }))
        )
      }
      return { added: addIds.length, removed: removeRows.length }
    })

    // 被移出租户的用户，JWT 用户态缓存里还带着本租户角色（RolesGuard 直接读它），必须立刻失效
    for (const userId of removedUserIds) {
      this.authUserCache.invalidate(userId)
    }
    this.tenantAccess.invalidate()
    return result
  }

  /** 单租户人数（列表页批量取用） */
  private async countUsers(tenantIds: number[]): Promise<Map<number, number>> {
    if (!tenantIds.length) return new Map()
    const rows = await this.userTenantRepository
      .createQueryBuilder('ut')
      .select('ut.tenant_id', 'tenantId')
      .addSelect('COUNT(*)', 'count')
      .where('ut.tenant_id IN (:...tenantIds)', { tenantIds })
      .andWhere('ut.status = 0')
      .groupBy('ut.tenant_id')
      .getRawMany<{ tenantId: number; count: string }>()
    return new Map(rows.map(row => [Number(row.tenantId), Number(row.count)]))
  }

  /** 编码唯一（软删的记录也占唯一索引，所以不带 del_flag 条件） */
  private async assertCodeAvailable(code: string, excludeId?: number): Promise<void> {
    const qb = this.repository.createQueryBuilder('t').where('t.code = :code', { code })
    if (excludeId) qb.andWhere('t.id <> :excludeId', { excludeId })
    if (await qb.getExists()) {
      throw new BizException(BizErrorCode.TENANT_CODE_CONFLICT, `租户编码「${code}」已存在`, HttpStatus.BAD_REQUEST)
    }
  }
}
