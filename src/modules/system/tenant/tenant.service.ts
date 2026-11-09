import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { Brackets, DataSource, Repository } from 'typeorm'

import { Pagination } from '../../../helper/paginate/pagination'
import { TenantAccessService } from '../../../shared/tenant/tenant-access.service'
import { TenantContext } from '../../../shared/tenant/tenant.context'
import { isDuplicateEntryError } from '../../../utils/db-error.util'
import { CreateTenantDto } from './dto/create-tenant.dto'
import { QueryTenantDto } from './dto/query-tenant.dto'
import { QueryTenantUserDto } from './dto/tenant-user.dto'
import { UpdateTenantDto } from './dto/update-tenant.dto'
import { TenantEntity } from './entities/tenant.entity'
import { UserTenantEntity } from './entities/user-tenant.entity'
import { TenantProvisionService } from './tenant-provision.service'

/** 租户下的用户（只暴露安全字段，密码/盐不出现在这里） */
export interface TenantUserItem {
  id: string
  username: string
  realname: string
  status: number
  joinTime: Date | null
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
    private readonly provision: TenantProvisionService
  ) {}

  /** 分页列表（租户是平台级数据，不参与租户隔离） */
  async list(query: QueryTenantDto): Promise<Pagination<TenantEntity>> {
    const page = query.current ?? 1
    const size = query.size ?? 10
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

    // 带出每个租户的人数，列表页不用再逐个请求
    qb.orderBy('t.id', 'ASC')
      .skip((page - 1) * size)
      .take(size)
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
        throw new BadRequestException(`租户编码「${dto.code}」已存在`)
      }
      throw error
    }
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
        throw new BadRequestException(`租户编码「${dto.code}」已存在`)
      }
      throw error
    }
    // 改了状态/到期日会影响归属校验结果
    this.tenantAccess.invalidate()
    return this.findOne(id)
  }

  /** 删除：软删。租户下还有用户时拒绝，避免一键让整租户的账号没有归属 */
  async remove(id: number): Promise<void> {
    if (id === 1) {
      throw new BadRequestException('默认租户不允许删除')
    }
    await this.findOne(id)
    const userCount = await this.userTenantRepository.count({ where: { tenantId: id, status: 0 } })
    if (userCount > 0) {
      throw new BadRequestException(`该租户下还有 ${userCount} 个用户，请先在「分配用户」里移除后再删除`)
    }
    await this.repository.update(id, { delFlag: 1, updateTime: new Date() })
    this.tenantAccess.invalidate()
  }

  /**
   * 我所属的租户（含当前生效租户），登录即可访问
   *
   * 超管走平台视角，可以看到全部租户并随意切进去排查问题；
   * 普通用户只列自己 sys_user_tenant 里的那些。
   */
  async mine(userId: string): Promise<{
    current: number | null
    isSuper: boolean
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

  /** 切换当前租户：校验归属后记住选择，后续请求由请求头生效 */
  async switch(userId: string, tenantId: number): Promise<{ tenantId: number | null }> {
    // 0 = 回到平台视角（不过滤），只对超管开放
    if (tenantId <= 0) {
      const membership = await this.tenantAccess.loadMembership(userId)
      if (!membership.isSuper) {
        throw new BadRequestException('只有平台管理员可以切换到平台视角')
      }
      await this.dataSource.query('UPDATE sys_user SET login_tenant_id = NULL WHERE id = ?', [userId])
      return { tenantId: null }
    }
    const resolved = await this.tenantAccess.resolveTenant(userId, tenantId)
    // 记住选择，下次不带请求头时用它做默认
    await this.dataSource.query('UPDATE sys_user SET login_tenant_id = ? WHERE id = ?', [tenantId, userId])
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

    const result = await this.dataSource.transaction(async manager => {
      const current = await manager.find(UserTenantEntity, { where: { tenantId } })
      const currentIds = new Set(current.map(item => item.userId))
      const targetSet = new Set(targetIds)

      const removeRows = current.filter(item => !targetSet.has(item.userId))
      const addIds = targetIds.filter(id => !currentIds.has(id))

      if (removeRows.length) {
        await manager.delete(
          UserTenantEntity,
          removeRows.map(item => item.id)
        )
        await manager.query(`UPDATE sys_user SET login_tenant_id = NULL WHERE login_tenant_id = ? AND id IN (${removeRows.map(() => '?').join(',')})`, [
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
      throw new BadRequestException(`租户编码「${code}」已存在`)
    }
  }
}
