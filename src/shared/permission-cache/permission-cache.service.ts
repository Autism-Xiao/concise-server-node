import { Injectable, Logger } from '@nestjs/common'
import { DataSource } from 'typeorm'

import { RedisService } from '../redis/redis.service'

/** 单角色权限缓存 key 前缀 */
const KEY_PREFIX = 'perm:role:'

/** 租户功能套餐权限缓存 key 前缀 */
const TENANT_KEY_PREFIX = 'perm:tenant:'

/** 缓存有效期（秒）：只是兜底，真正保证一致性的是写入侧主动失效 */
const TTL_SECONDS = 300

/** 平台级权限集合的进程内缓存时长（菜单改动后会主动清空） */
const PLATFORM_TTL_MS = 60_000

/**
 * 角色 → 按钮权限集合 缓存
 *
 * 为什么需要：PermsGuard 是全局守卫，每个带 @Perms() 的请求都要跑一次
 * sys_permission ⋈ sys_role_permission 的两表 join。管理后台一屏就是几十个请求，
 * 这类「几乎不变、按角色分片」的数据是典型的缓存对象。
 *
 * 设计要点：
 *  - 按 **角色** 而不是按用户缓存：用户挂多角色时把结果合并即可，用户换角色不需要清缓存；
 *  - 写侧主动失效：角色授权（assignMenus）、角色删除、菜单权限改动后立刻 del，
 *    保证「改完权限马上生效」，不依赖 TTL 过期；
 *  - Redis 不可用（或未启用）时直接查库，行为与改造前一致，不引入单点故障；
 *  - 缓存内容只存 perms 字符串数组，不存菜单对象，避免脏数据放大。
 */
@Injectable()
export class PermissionCacheService {
  private readonly logger = new Logger(PermissionCacheService.name)
  /** 降级日志只打一次，避免 Redis 抖动时刷屏 */
  private degradedLogged = false
  /** 平台级权限集合的进程内缓存（菜单作用域改动后清空） */
  private platformPerms: { at: number; set: Set<string> } | null = null

  constructor(
    private readonly redis: RedisService,
    private readonly dataSource: DataSource
  ) {}

  /** 取单个角色的权限标识集合（含缓存） */
  async getRolePerms(roleId: string): Promise<string[]> {
    const client = this.redis.client
    if (client) {
      try {
        const cached = await client.get(KEY_PREFIX + roleId)
        if (cached !== null) {
          return JSON.parse(cached) as string[]
        }
      } catch (error) {
        this.warnDegraded(error)
      }
    }

    const perms = await this.loadRolePerms(roleId)

    if (client) {
      try {
        await client.setex(KEY_PREFIX + roleId, TTL_SECONDS, JSON.stringify(perms))
      } catch (error) {
        this.warnDegraded(error)
      }
    }
    return perms
  }

  /** 合并多个角色的权限标识（守卫直接用这个） */
  async getRolesPerms(roleIds: string[]): Promise<Set<string>> {
    if (roleIds.length === 0) {
      return new Set()
    }
    const lists = await Promise.all(roleIds.map(roleId => this.getRolePerms(roleId)))
    return new Set(lists.flat())
  }

  /**
   * 租户功能套餐对应的权限码集合（sys_tenant_menu ⋈ sys_permission）
   *
   * 语义：空集合 = 该租户没有开通任何功能（fail-closed），是有效结果而不是缓存未命中。
   * PermsGuard 用它和角色权限取交集：收窄套餐后，即使角色历史上授权过被收回的菜单，
   * 接口也会立即 403，不用等角色授权被清理。
   */
  async getTenantPerms(tenantId: number): Promise<Set<string>> {
    if (tenantId <= 0) return new Set()
    const key = TENANT_KEY_PREFIX + tenantId
    const client = this.redis.client
    if (client) {
      try {
        const cached = await client.get(key)
        if (cached !== null) {
          return new Set(JSON.parse(cached) as string[])
        }
      } catch (error) {
        this.warnDegraded(error)
      }
    }

    const rows = await this.dataSource
      .createQueryBuilder()
      .select('p.perms', 'perms')
      .from('sys_permission', 'p')
      .innerJoin('sys_tenant_menu', 'tm', 'tm.permission_id = p.id')
      .where('tm.tenant_id = :tenantId', { tenantId })
      .andWhere("p.scope = 'tenant'")
      .andWhere("p.status = '1'")
      .andWhere('p.del_flag = 0')
      .getRawMany<{ perms: string | null }>()
    const perms = [...new Set(rows.map(row => row.perms).filter((perm): perm is string => !!perm))]

    if (client) {
      try {
        await client.setex(key, TTL_SECONDS, JSON.stringify(perms))
      } catch (error) {
        this.warnDegraded(error)
      }
    }
    return new Set(perms)
  }

  /** 套餐变更后调用：该租户的套餐权限集合已变 */
  async invalidateTenant(tenantId: number): Promise<void> {
    const client = this.redis.client
    if (!client) return
    try {
      await client.del(TENANT_KEY_PREFIX + tenantId)
    } catch (error) {
      this.warnDegraded(error)
    }
  }

  /**
   * 平台级权限标识集合（sys_permission.scope='platform'）
   *
   * PermsGuard 用它做「作用域拦截」：命中的权限码要求 is_platform_admin=1，
   * 避免租户管理员通过自建角色把「创建租户」「改菜单」这类平台能力授给自己。
   *
   * 只走进程内缓存（60s）+ 写侧清空：这是一份**全表小集合**（几十条），
   * 没必要按角色分片，也没有多实例强一致要求（菜单改动后 60s 内生效可接受）。
   */
  async getPlatformPerms(): Promise<Set<string>> {
    const now = Date.now()
    if (this.platformPerms && now - this.platformPerms.at < PLATFORM_TTL_MS) {
      return this.platformPerms.set
    }
    const rows = await this.dataSource
      .createQueryBuilder()
      .select('p.perms', 'perms')
      .from('sys_permission', 'p')
      .where("p.scope = 'platform'")
      .andWhere("p.status = '1'")
      .andWhere('p.del_flag = 0')
      .getRawMany<{ perms: string | null }>()
    const set = new Set(rows.map(row => row.perms).filter((perm): perm is string => !!perm))
    this.platformPerms = { at: now, set }
    return set
  }

  /** 角色授权/改名/删除后调用：该角色的权限集合已变 */
  async invalidateRole(roleId: string): Promise<void> {
    const client = this.redis.client
    if (!client) return
    try {
      await client.del(KEY_PREFIX + roleId)
    } catch (error) {
      this.warnDegraded(error)
    }
  }

  /** 菜单权限标识/状态/作用域变化后调用：所有角色都可能受影响 */
  async invalidateAll(): Promise<void> {
    // 进程内的平台权限集合也必须失效，否则改了 scope 要等 TTL 才生效
    this.platformPerms = null
    const client = this.redis.client
    if (!client) return
    try {
      // 角色 + 租户套餐两类 key 都要清。数量有限，SCAN 比 KEYS 安全：不阻塞 Redis 主线程
      for (const pattern of [`${KEY_PREFIX}*`, `${TENANT_KEY_PREFIX}*`]) {
        let cursor = '0'
        do {
          const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200)
          cursor = next
          if (keys.length > 0) {
            await client.del(...keys)
          }
        } while (cursor !== '0')
      }
    } catch (error) {
      this.warnDegraded(error)
    }
  }

  /** 真正的查库：只统计启用且未删除的菜单，和守卫里的 SQL 保持一致 */
  private async loadRolePerms(roleId: string): Promise<string[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select('p.perms', 'perms')
      .from('sys_permission', 'p')
      .innerJoin('sys_role_permission', 'rp', 'rp.permission_id = p.id')
      .where('rp.role_id = :roleId', { roleId })
      .andWhere("p.status = '1'")
      .andWhere('p.del_flag = 0')
      .getRawMany<{ perms: string | null }>()

    return [...new Set(rows.map(row => row.perms).filter((perm): perm is string => !!perm))]
  }

  private warnDegraded(error: unknown): void {
    if (this.degradedLogged) return
    this.degradedLogged = true
    this.logger.warn(`权限缓存不可用，已降级为实时查库：${(error as Error)?.message ?? error}`)
  }
}
