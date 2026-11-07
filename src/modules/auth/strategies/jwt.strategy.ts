import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'

import { jwtConfig, type JwtConfig } from '../../../config'
import { UserService } from '../../user/user.service'
import { OnlineService, type SessionRequest } from '../../ops/online/online.service'
import type { JwtPayload } from '../services/auth.service'

/** 鉴权时能拿到的请求形态（含原始 token，用于会话登记与黑名单校验） */
interface RequestWithToken extends SessionRequest {
  headers: {
    authorization?: string
    'user-agent'?: string | string[]
  }
}

/** 从 Authorization: Bearer <token> 里取原始 token */
function extractToken(request: RequestWithToken): string | null {
  const header = request.headers.authorization
  if (!header) return null
  const [scheme, token] = header.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token ? token : null
}

/**
 * 从 Authorization: Bearer <token> 解析并校验 accessToken
 *
 * 除常规校验外做两件事（在线用户 / 强制下线，对齐 JeecgBoot 用 Redis 管在线态的做法）：
 * 1. 查 online:revoked:<tokenHash> 黑名单，命中直接 401（被踢下线的令牌立即失效）
 * 2. 校验通过后按 token 哈希登记/刷新 online:session:<tokenHash>，TTL 到 token 过期
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(jwtConfig.KEY) jwt: JwtConfig,
    private readonly userService: UserService,
    private readonly onlineService: OnlineService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwt.secret,
      passReqToCallback: true
    })
  }

  /** 校验通过后触发：确认用户仍存在且未冻结（带角色，供 RolesGuard 使用），返回值挂到 req.user */
  async validate(request: RequestWithToken, payload: JwtPayload) {
    const token = extractToken(request)
    const issuedAt = (payload as { iat?: number }).iat

    // 令牌黑名单（强制下线/登出）+ 用户级下线（refreshToken 重放时踢全量会话）
    if (token && (await this.onlineService.isSessionInvalid(token, String(payload.id), issuedAt))) {
      throw new UnauthorizedException('登录状态已失效，请重新登录')
    }

    const user = await this.findUserCached(String(payload.id))
    if (!user || user.status !== 1) {
      throw new UnauthorizedException('账号不存在或已被冻结')
    }
    // 停用角色不参与鉴权：RolesGuard / @Roles 匹配的 req.user.roles 在这里统一裁剪
    user.roles = (user.roles ?? []).filter(role => role.status !== 0)

    if (token) {
      await this.onlineService.touch(token, { id: payload.id, username: payload.username, exp: (payload as { exp?: number }).exp }, request, user)
    }
    return user
  }

  /**
   * 用户态短缓存：validate 在**每个鉴权请求**都会执行，findOneWithRoles（users+user_roles+roles 三表 join）
   * 是热路径最大的单笔开销。30s 内存缓存后，绝大多数请求免去这次查库。
   * 一致性边界：冻结/删除/改角色最多延迟 30s 生效（安全上可接受——密码错误锁定、
   * 强制下线走上面的 Redis 黑名单，不受缓存影响、即时生效）；角色授权变更后需要立即生效的场景，
   * 已有的 PermissionCacheService 同样是缓存语义，前端重新登录或调权限缓存清理接口即可。
   */
  private static readonly USER_CACHE_TTL_MS = 30_000
  private readonly userCache = new Map<string, { value: Awaited<ReturnType<UserService['findOneWithRoles']>> | null; expiresAt: number }>()

  private async findUserCached(userId: string) {
    const cached = this.userCache.get(userId)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    const user = await this.userService.findOneWithRoles(userId)
    // 顺手清理：缓存条目数超 2 倍常见在线用户量时清一遍过期项，防长期驻留泄漏
    if (this.userCache.size > 2000) {
      const now = Date.now()
      for (const [key, entry] of this.userCache) {
        if (entry.expiresAt <= now) this.userCache.delete(key)
      }
    }
    this.userCache.set(userId, { value: user, expiresAt: Date.now() + JwtStrategy.USER_CACHE_TTL_MS })
    return user
  }
}
