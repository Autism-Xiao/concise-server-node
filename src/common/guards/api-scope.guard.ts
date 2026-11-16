import { Injectable, type CanActivate, type ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { API_SCOPE_KEY } from '../decorators/api-scope.decorator'

/** 应用令牌在 req.user 上的形态（JwtStrategy.validate 识别 app payload 后挂的） */
export interface AppTokenUser {
  isApp: true
  id: string
  username: string
  scopes: string[]
}

/**
 * 开放接口 scope 守卫（全局，排在 PermsGuard 之后）
 *
 * 只对声明了 @ApiScope 的接口生效，且只约束应用令牌：
 *  - 应用令牌：必须持有声明的 scope 中至少一个，否则 403（错误信息带上缺哪个，对接方能自查）；
 *  - 用户令牌：直接放行 —— 开放接口同时是内部管理台可用的接口，用户权限由 @Perms（若有）判定；
 *  - 未声明 @ApiScope 的接口一律放行（本守卫不参与）。
 */
@Injectable()
export class ApiScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(API_SCOPE_KEY, [context.getHandler(), context.getClass()])
    if (!required || required.length === 0) return true

    const request = context.switchToHttp().getRequest()
    const user = request.user as AppTokenUser | undefined
    if (!user?.isApp) return true

    const granted: string[] = user.scopes ?? []
    const ok = required.some(scope => granted.includes(scope))
    if (!ok) {
      throw new ForbiddenException(`应用令牌缺少授权范围：需要 ${required.join(' / ')} 之一，请让管理员在「开放平台」调整应用授权`)
    }
    return true
  }
}
