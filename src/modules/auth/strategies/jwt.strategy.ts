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

    const user = await this.userService.findOneWithRoles(String(payload.id))
    if (!user || user.status !== 1) {
      throw new UnauthorizedException('账号不存在或已被冻结')
    }

    if (token) {
      await this.onlineService.touch(token, { id: payload.id, username: payload.username, exp: (payload as { exp?: number }).exp }, request, user)
    }
    return user
  }
}
