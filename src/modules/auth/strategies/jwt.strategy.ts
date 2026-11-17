import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'

import { jwtConfig, type JwtConfig } from '../../../config'
import { AuthUserCacheService } from '../../../shared/auth-cache/auth-user-cache.service'
import { TenantContext } from '../../../shared/tenant/tenant.context'
import { AppService } from '../../openapi/app.service'
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
 * 除常规校验外做两件事：
 * 1. 查 online:revoked:<tokenHash> 黑名单，命中直接 401（被踢下线的令牌立即失效）
 * 2. 校验通过后按 token 哈希登记/刷新 online:session:<tokenHash>，TTL 到 token 过期
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(jwtConfig.KEY) jwt: JwtConfig,
    private readonly userService: UserService,
    private readonly onlineService: OnlineService,
    private readonly authUserCache: AuthUserCacheService,
    private readonly appService: AppService
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

    // 应用令牌（client_credentials 换发）：payload 带 app=true，没有"用户/会话/黑名单"概念。
    // 实时查应用状态与最新 scope：停用/删除/改授权范围对已签发令牌即时生效，不留窗口期
    if ((payload as { app?: boolean }).app === true) {
      const app = await this.appService.resolveActiveApp(String(payload.id))
      if (!app) {
        throw new UnauthorizedException('应用已被停用或删除，请重新获取令牌')
      }
      return {
        id: app.id,
        username: app.appName,
        isApp: true,
        // 应用归属租户：开放接口按它过滤数据（tenantId=0 的平台应用可见全平台数据）
        tenantId: app.tenantId,
        scopes: this.appService.parseScopes(app),
        roles: [],
        isPlatformAdmin: 0
      }
    }

    // 令牌黑名单（强制下线/登出）+ 用户级下线（refreshToken 重放时踢全量会话）
    if (token && (await this.onlineService.isSessionInvalid(token, String(payload.id), issuedAt))) {
      throw new UnauthorizedException('登录状态已失效，请重新登录')
    }

    const user = await this.findUserCached(String(payload.id))
    if (!user || user.status !== 1) {
      throw new UnauthorizedException('账号不存在或已被冻结')
    }
    // 角色按**当前租户**收窄，不能只过滤停用标记：
    // 一个账号可能同时是 A 公司管理员、B 公司访客（同一个人属于两家公司很常见）。
    // X-Tenant-Id 切到 B 时，req.user.roles 若还带着 A 的 admin 角色：
    //  - PermsGuard 按 roleIds 取权限并集 → 在 B 里拿到了 A 的按钮权限；
    //  - RolesGuard 按 roleCode 匹配 → 在 B 里被当成 admin；
    //  - UserService.applyDataScope 取 data_scope 最小值 → 在 B 里拿到 A 的全量数据范围。
    // 平台共享角色（tenant_id=0）始终有效；平台视角（null）不过滤。
    // 注意：findUserCached 返回的是缓存里的同一个对象，必须复制后再改，不能就地赋值。
    const scopedTenantId = TenantContext.filterTenantId()
    const scopedRoles = (user.roles ?? []).filter(role => {
      if (role.status === 0) return false
      if (scopedTenantId === null) return true
      const owner = Number(role.tenantId ?? 0)
      return owner === 0 || owner === scopedTenantId
    })
    const scopedUser = { ...user, roles: scopedRoles, mfaPending: (payload as { mfaPending?: boolean }).mfaPending === true }

    if (token) {
      await this.onlineService.touch(token, { id: payload.id, username: payload.username, exp: (payload as { exp?: number }).exp }, request, scopedUser)
    }
    return scopedUser
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
