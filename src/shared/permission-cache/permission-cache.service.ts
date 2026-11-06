import { Injectable, Logger } from '@nestjs/common'
import { DataSource } from 'typeorm'

import { RedisService } from '../redis/redis.service'

/** 单角色权限缓存 key 前缀 */
const KEY_PREFIX = 'perm:role:'

/** 缓存有效期（秒）：只是兜底，真正保证一致性的是写入侧主动失效 */
const TTL_SECONDS = 300

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

  /** 菜单权限标识/状态变化后调用：所有角色都可能受影响 */
  async invalidateAll(): Promise<void> {
    const client = this.redis.client
    if (!client) return
    try {
      let cursor = '0'
      do {
        // 角色数量有限（几十个），SCAN 比 KEYS 安全：不阻塞 Redis 主线程
        const [next, keys] = await client.scan(cursor, 'MATCH', `${KEY_PREFIX}*`, 'COUNT', 200)
        cursor = next
        if (keys.length > 0) {
          await client.del(...keys)
        }
      } while (cursor !== '0')
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
