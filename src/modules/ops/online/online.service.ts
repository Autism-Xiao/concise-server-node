import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { createHash } from 'node:crypto'

import { Pagination } from '../../../helper/paginate'
import { RedisService } from '../../../shared/redis/redis.service'
import { parseRequestInfo } from '../../../utils/request-info.util'
import type { QueryOnlineDto } from './dto/query-online.dto'

/** 在线会话 key 前缀（Redis 3.x 兼容：只用一个前缀做 SCAN match） */
const SESSION_PREFIX = 'online:session:'
/** 强制下线的令牌黑名单前缀（TTL 到 token 自然过期即可） */
const REVOKED_PREFIX = 'online:revoked:'

export interface OnlineSession {
  sessionId: string
  userId: string
  username: string
  dept: string
  ip: string
  location: string
  browser: string
  os: string
  loginTime: string
  lastActive: string
  expiresAt: string
}

/** JWT 策略里能拿到的请求最小形态（避免依赖 express 类型） */
export interface SessionRequest {
  ip?: string
  headers: { 'user-agent'?: string | string[] | undefined }
}

export interface SessionUser {
  id: string
  username: string
  depts?: { departName?: string }[]
}

/**
 * 在线用户（对齐 JeecgBoot 的做法：不建表，在线状态存 Redis）
 *
 * JeecgBoot 的在线用户来自 Redis 里的 token 记录 + 强制下线；本项目 JWT 无状态，
 * 因此在 JwtStrategy 每次校验通过时按 accessToken 的哈希登记一条会话：
 *   online:session:<tokenHash>  → JSON（账号/部门/IP/归属地/浏览器/系统/登录时间）
 *   online:revoked:<tokenHash>  → 强制下线黑名单，TTL 到 token 过期
 * 这样「在线列表」是真实的（有请求即在线），「强制下线」也是真的（后续请求 401）。
 */
@Injectable()
export class OnlineService {
  private readonly logger = new Logger(OnlineService.name)
  private warned = false

  constructor(private readonly redis: RedisService) {}

  /** token 哈希作为会话编号（不落原始 token，泄露也拿不到凭证） */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex').slice(0, 32)
  }

  /** 每次鉴权通过时登记/刷新会话 */
  async touch(token: string, payload: { id: string; username: string; exp?: number }, request: SessionRequest, user?: SessionUser): Promise<void> {
    const client = this.client()
    if (!client) return
    try {
      const now = Math.floor(Date.now() / 1000)
      const exp = payload.exp ?? now + 7200
      const ttl = exp - now
      if (ttl <= 0) return

      const sessionId = this.hashToken(token)
      const key = SESSION_PREFIX + sessionId
      const existing = await client.get(key)
      const loginTime = existing ? (this.parse<OnlineSession>(existing)?.loginTime ?? new Date().toISOString()) : new Date().toISOString()
      const ip = (request.ip ?? '').replace(/^::ffff:/, '')
      const userAgent = Array.isArray(request.headers['user-agent']) ? request.headers['user-agent'][0] : request.headers['user-agent']
      const info = parseRequestInfo(ip, userAgent)

      const session: OnlineSession = {
        sessionId,
        userId: payload.id,
        username: payload.username,
        dept: user?.depts?.[0]?.departName ?? '',
        ip,
        location: info.location,
        browser: info.browser,
        os: info.os,
        loginTime,
        lastActive: new Date().toISOString(),
        expiresAt: new Date(exp * 1000).toISOString()
      }
      // Redis 3.x 兼容：用 SETEX 写整串 JSON（不用 HSET 多字段）
      await client.setex(key, ttl, JSON.stringify(session))
    } catch (error) {
      this.warnOnce(`在线会话登记失败：${(error as Error).message}`)
    }
  }

  /**
   * 退出登录：令牌拉黑 + 删除在线会话（幂等，不要求会话存在）
   * - accessToken 拉黑后 JwtStrategy 每次请求都会 401
   * - refreshToken 一并拉黑（同一黑名单空间，哈希不同不冲突），防止登出后用 refreshToken 续命
   * - Redis 未启用时静默跳过（JWT 无状态，登出仅退化为前端清 token）
   */
  async logout(token: string, ttlSeconds: number, refreshToken?: string, refreshTtlSeconds?: number): Promise<void> {
    const client = this.client()
    if (!client) return
    try {
      const ttl = Math.max(Math.floor(ttlSeconds), 60)
      await client.setex(REVOKED_PREFIX + this.hashToken(token), ttl, '1')
      await client.del(SESSION_PREFIX + this.hashToken(token))
      if (refreshToken) {
        await client.setex(REVOKED_PREFIX + this.hashToken(refreshToken), Math.max(Math.floor(refreshTtlSeconds ?? ttl), 60), '1')
      }
    } catch (error) {
      this.warnOnce(`退出登录处理失败：${(error as Error).message}`)
    }
  }

  /** 是否已被强制下线 */
  async isRevoked(token: string): Promise<boolean> {
    const client = this.client()
    if (!client) return false
    try {
      const value = await client.get(REVOKED_PREFIX + this.hashToken(token))
      return value !== null
    } catch (error) {
      this.warnOnce(`下线状态查询失败：${(error as Error).message}`)
      return false
    }
  }

  /** 在线用户列表（Redis SCAN 后按关键字过滤、按登录时间倒序、内存分页） */
  async list(query: QueryOnlineDto): Promise<Pagination<OnlineSession>> {
    const client = this.client()
    const page = Math.max(query.page ?? 1, 1)
    const pageSize = Math.max(query.pageSize ?? 10, 1)
    if (!client) {
      return new Pagination<OnlineSession>([], 0, page, pageSize)
    }

    let sessions: OnlineSession[] = []
    try {
      const keys: string[] = []
      let cursor = '0'
      do {
        const [next, batch] = await client.scan(cursor, 'MATCH', `${SESSION_PREFIX}*`, 'COUNT', 200)
        cursor = next
        keys.push(...batch)
      } while (cursor !== '0')

      if (keys.length) {
        const values = await client.mget(...keys)
        sessions = values.map(value => (value ? this.parse<OnlineSession>(value) : null)).filter((item): item is OnlineSession => item !== null)
      }
    } catch (error) {
      this.warnOnce(`在线会话读取失败：${(error as Error).message}`)
      return new Pagination<OnlineSession>([], 0, page, pageSize)
    }

    const keyword = query.keyword?.trim().toLowerCase()
    if (keyword) {
      sessions = sessions.filter(item =>
        [item.username, item.ip, item.location, item.browser, item.os, item.dept].some(field => (field ?? '').toLowerCase().includes(keyword))
      )
    }
    sessions.sort((a, b) => b.loginTime.localeCompare(a.loginTime))

    const start = (page - 1) * pageSize
    return new Pagination(sessions.slice(start, start + pageSize), sessions.length, page, pageSize)
  }

  /** 强制下线：删会话 + 进黑名单（后续请求由 JwtStrategy 拦截） */
  async kick(sessionId: string): Promise<void> {
    const client = this.client()
    if (!client) {
      throw new NotFoundException('在线会话不存在或已过期')
    }
    const key = SESSION_PREFIX + sessionId
    const raw = await client.get(key)
    const session = raw ? this.parse<OnlineSession>(raw) : null
    if (!session) {
      throw new NotFoundException('在线会话不存在或已过期')
    }
    const ttl = Math.max(Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000), 60)
    await client.setex(REVOKED_PREFIX + sessionId, ttl, '1')
    await client.del(key)
  }

  /** 批量强退：逐条踢，会话已过期的不算失败（本来就不在线） */
  async batchKick(sessionIds: string[]): Promise<{ kicked: number; failed: Array<{ id: string; reason: string }> }> {
    const ids = [...new Set(sessionIds.map(id => String(id ?? '').trim()).filter(Boolean))]
    if (!ids.length) {
      throw new BadRequestException('请选择要下线的用户')
    }
    if (ids.length > 200) {
      throw new BadRequestException('单次最多下线 200 个会话，请分批操作')
    }
    const result: { kicked: number; failed: Array<{ id: string; reason: string }> } = { kicked: 0, failed: [] }
    for (const id of ids) {
      try {
        await this.kick(id)
        result.kicked += 1
      } catch (error) {
        result.failed.push({ id, reason: error instanceof Error ? error.message : '下线失败' })
      }
    }
    return result
  }

  /** 在线人数（登录页/首页展示可用） */
  async count(): Promise<number> {
    const client = this.client()
    if (!client) return 0
    try {
      let cursor = '0'
      let count = 0
      do {
        const [next, batch] = await client.scan(cursor, 'MATCH', `${SESSION_PREFIX}*`, 'COUNT', 500)
        cursor = next
        count += batch.length
      } while (cursor !== '0')
      return count
    } catch (error) {
      this.warnOnce(`在线人数统计失败：${(error as Error).message}`)
      return 0
    }
  }

  private client() {
    if (!this.redis.enabled || !this.redis.client) {
      this.warnOnce('Redis 未启用，在线用户与强制下线不可用（REDIS_ENABLED=false）')
      return null
    }
    return this.redis.client
  }

  private parse<T>(value: string): T | null {
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }

  private warnOnce(message: string): void {
    if (this.warned) return
    this.warned = true
    this.logger.warn(message)
  }
}
