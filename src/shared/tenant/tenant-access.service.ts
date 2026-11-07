import { ForbiddenException, Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'

/** 用户所属租户（含状态，供前端标注停用/过期） */
export interface TenantMembershipItem {
  id: number
  name: string
  code: string
  status: number
  expireAt: string | null
}

export interface TenantMembership {
  isSuper: boolean
  tenants: TenantMembershipItem[]
  /** 上次登录/切换时选择的租户（sys_user.login_tenant_id），作为不带请求头时的默认值 */
  preferredTenantId: number | null
}

/** 缓存时长：切换租户后最多 30s 生效，足够抵住每请求两次查询 */
const CACHE_TTL_MS = 30_000

/**
 * 租户归属解析（中间件与租户接口共用）
 *
 * 两件事：
 * 1. 这个用户属于哪些租户（sys_user_tenant），以及是不是超管（sys_user_role）
 * 2. 给定 `X-Tenant-Id` 时算出**真正生效**的租户，并校验归属 —— 前端传来的 id 不可信
 *
 * 结果按 userId 缓存 30s；分配/移除租户后调用 `invalidate()` 立即失效。
 */
@Injectable()
export class TenantAccessService {
  private readonly logger = new Logger(TenantAccessService.name)
  private readonly cache = new Map<string, { at: number; value: TenantMembership }>()

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** 用户归属（带缓存） */
  async loadMembership(userId: string): Promise<TenantMembership> {
    const cached = this.cache.get(userId)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value

    const [roles, rows, preferred] = await Promise.all([
      this.dataSource.query<{ roleCode: string }[]>(
        'SELECT r.role_code AS roleCode FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id WHERE ur.user_id = ?',
        [userId]
      ),
      this.dataSource.query<{ id: number; name: string; code: string; status: number; expireAt: string | null }[]>(
        `SELECT t.id, t.name, t.code, t.status, DATE_FORMAT(t.expire_at, '%Y-%m-%d') AS expireAt
           FROM sys_user_tenant ut
           JOIN sys_tenant t ON t.id = ut.tenant_id
          WHERE ut.user_id = ? AND ut.status = 0 AND t.del_flag = 0
          ORDER BY t.id`,
        [userId]
      ),
      this.dataSource.query<{ loginTenantId: number | null }[]>('SELECT login_tenant_id AS loginTenantId FROM sys_user WHERE id = ?', [userId])
    ])

    const isSuper = roles.some(role => ['admin', 'superadmin'].includes(role.roleCode))
    const value: TenantMembership = {
      isSuper,
      tenants: rows.map(row => ({ ...row, id: Number(row.id), status: Number(row.status) })),
      preferredTenantId: preferred[0]?.loginTenantId != null ? Number(preferred[0].loginTenantId) : null
    }
    this.cache.set(userId, { at: Date.now(), value })
    return value
  }

  /**
   * 算出本次请求生效的租户
   *
   * - 超管：带了 `X-Tenant-Id` 就进那个租户，否则 `null`（平台视角，不过滤）
   * - 普通用户：只能选自己所属且可用的租户；没带则用默认（最近登录的，其次第一个可用）
   * - 一个租户都没有：`0`（只看平台共享数据，不泄漏别人租户的数据）
   */
  async resolveTenant(userId: string, requested?: number | null): Promise<{ tenantId: number | null; membership: TenantMembership }> {
    const membership = await this.loadMembership(userId)

    if (membership.isSuper) {
      if (requested && requested > 0) {
        await this.assertTenantUsable(requested)
        return { tenantId: requested, membership }
      }
      return { tenantId: null, membership }
    }

    const usable = membership.tenants.filter(item => this.isUsable(item))
    if (requested && requested > 0) {
      const target = membership.tenants.find(item => item.id === requested)
      if (!target) {
        throw new ForbiddenException('你不属于该租户，无法切换')
      }
      if (!this.isUsable(target)) {
        throw new ForbiddenException(`租户「${target.name}」已停用或已到期，请联系管理员`)
      }
      return { tenantId: target.id, membership }
    }

    // 优先用上次选择的租户，其次按 id 顺序取第一个可用租户
    const preferred = usable.find(item => item.id === membership.preferredTenantId)
    return { tenantId: preferred?.id ?? usable[0]?.id ?? 0, membership }
  }

  /** 租户是否可用（启用且未过期） */
  isUsable(tenant: { status: number; expireAt: string | null }): boolean {
    if (tenant.status !== 0) return false
    if (!tenant.expireAt) return true
    // expire_at 是「到期日」，当天仍可用，所以与今天做比较
    const today = new Date()
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    return tenant.expireAt >= todayKey
  }

  /** 目标租户必须存在、未删、状态正常、未过期 */
  private async assertTenantUsable(tenantId: number): Promise<void> {
    const rows = await this.dataSource.query<{ status: number; expireAt: string | null; delFlag: number }[]>(
      `SELECT status, DATE_FORMAT(expire_at, '%Y-%m-%d') AS expireAt, del_flag AS delFlag FROM sys_tenant WHERE id = ?`,
      [tenantId]
    )
    const tenant = rows[0]
    if (!tenant || Number(tenant.delFlag) === 1) {
      throw new ForbiddenException('租户不存在')
    }
    if (!this.isUsable({ status: Number(tenant.status), expireAt: tenant.expireAt })) {
      throw new ForbiddenException('该租户已停用或已到期')
    }
  }

  /** 归属变化后清缓存（不传则全清） */
  invalidate(userId?: string): void {
    if (userId) this.cache.delete(userId)
    else this.cache.clear()
    this.logger.debug(`租户归属缓存已失效：${userId ?? '全部'}`)
  }
}
