import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { createHash } from 'node:crypto'

import { Pagination } from '../../../helper/paginate'
import { RedisService } from '../../../shared/redis/redis.service'
import { parseRequestInfo } from '../../../utils/request-info.util'
import type { QueryOnlineDto } from './dto/query-online.dto'

/** 在线会话 key 前缀（Redis 3.x 兼容：只用一个前缀做 SCAN match） */
const SESSION_PREFIX = 'online:session:'
/** 强制下线的令牌黑名单前缀（TTL 到 token 自然过期即可，值记录拉黑时间戳用于重放判定） */
const REVOKED_PREFIX = 'online:revoked:'
/** 按用户维度的强制下线前缀：值记录时间戳，签发早于该时间的令牌一律失效 */
const USER_REVOKED_PREFIX = 'online:user-revoked:'
/** 会话活跃时间最小写入间隔（秒）：每个请求都写 Redis 太浪费，1 分钟粒度足够展示 */
const TOUCH_INTERVAL_SECONDS = 60

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
      const previous = existing ? this.parse<OnlineSession>(existing) : null
      // 降频：60 秒内已写过就跳过，避免每个请求 1 次 SETEX（QPS 上来后 Redis 写放大）
      if (previous && Date.now() - new Date(previous.lastActive).getTime() < TOUCH_INTERVAL_SECONDS * 1000) {
        return
      }
      const loginTime = previous?.loginTime ?? new Date().toISOString()
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
      await this.markRevoked(token, ttl)
      await client.del(SESSION_PREFIX + this.hashToken(token))
      if (refreshToken) {
        await this.markRevoked(refreshToken, Math.max(Math.floor(refreshTtlSeconds ?? ttl), 60))
      }
    } catch (error) {
      this.warnOnce(`退出登录处理失败：${(error as Error).message}`)
    }
  }

  /**
   * 拉黑一个令牌（access / refresh 共用同一黑名单空间，哈希不同不冲突）
   * 值存拉黑时间戳，refreshToken 轮换时靠它判断「是并发刷新还是真被盗用」
   */
  async markRevoked(token: string, ttlSeconds: number): Promise<void> {
    const client = this.client()
    if (!client) return
    try {
      await client.setex(REVOKED_PREFIX + this.hashToken(token), Math.max(Math.floor(ttlSeconds), 60), String(Date.now()))
    } catch (error) {
      this.warnOnce(`令牌拉黑失败：${(error as Error).message}`)
    }
  }

  /** 令牌是否已失效，以及（若失效）失效时间：用于 refreshToken 重放检测 */
  async getRevocation(token: string): Promise<{ revoked: boolean; at: number }> {
    const client = this.client()
    if (!client) return { revoked: false, at: 0 }
    try {
      const value = await client.get(REVOKED_PREFIX + this.hashToken(token))
      if (value === null) return { revoked: false, at: 0 }
      const at = Number(value)
      return { revoked: true, at: Number.isFinite(at) ? at : 0 }
    } catch (error) {
      this.warnOnce(`下线状态查询失败：${(error as Error).message}`)
      return { revoked: false, at: 0 }
    }
  }

  /** 是否已被强制下线 */
  async isRevoked(token: string): Promise<boolean> {
    return (await this.getRevocation(token)).revoked
  }

  /**
   * 按用户维度强制下线：之后签发时间早于此刻的令牌全部失效
   * 用于「refreshToken 被重复使用」这类确定被盗用的场景，一次踢掉该账号所有会话
   */
  async revokeUser(userId: string, ttlSeconds: number): Promise<void> {
    const client = this.client()
    if (!client || !userId) return
    try {
      await client.setex(USER_REVOKED_PREFIX + userId, Math.max(Math.floor(ttlSeconds), 60), String(Date.now()))
    } catch (error) {
      this.warnOnce(`用户级下线失败：${(error as Error).message}`)
    }
  }

  /** 该令牌是否已失效（令牌黑名单 + 用户级下线两个维度，合并成一次往返） */
  async isSessionInvalid(token: string, userId: string, issuedAtSeconds?: number): Promise<boolean> {
    const client = this.client()
    if (!client) return false
    try {
      const [tokenValue, userValue] = await client.mget(REVOKED_PREFIX + this.hashToken(token), USER_REVOKED_PREFIX + userId)
      if (tokenValue !== null) {
        return true
      }
      if (userValue !== null && issuedAtSeconds) {
        const at = Number(userValue)
        return Number.isFinite(at) && issuedAtSeconds * 1000 < at
      }
      return false
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
    // sessionId 本身就是 token 哈希，这里直接拼 key（不能再走 markRevoked，那会二次哈希）
    await client.setex(REVOKED_PREFIX + sessionId, ttl, String(Date.now()))
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
