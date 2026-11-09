import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'

import { jwtConfig, type JwtConfig } from '../../../config'
import { AuthUserCacheService } from '../../../shared/auth-cache/auth-user-cache.service'
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
    private readonly onlineService: OnlineService,
    private readonly authUserCache: AuthUserCacheService
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
   *
   * 一致性边界：账号状态 / 角色绑定 / 平台管理员标记变更时，写路径会调
   * `AuthUserCacheService.invalidate(userId)` 立即失效（见 UserService.setStatus / assignRoles /
   * setPlatformAdmin / delete），因此这类降权是即时的；只有直接改库才需要等 30s。
   * 密码错误锁定、强制下线走 Redis 黑名单，不受缓存影响。
   */
  private async findUserCached(userId: string) {
    const cached = this.authUserCache.get<Awaited<ReturnType<UserService['findOneWithRoles']>>>(userId)
    if (cached !== undefined) return cached

    const user = await this.userService.findOneWithRoles(userId)
    this.authUserCache.set(userId, user)
    return user
  }
}
