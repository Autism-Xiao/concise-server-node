import { Injectable, ExecutionContext } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { Reflector } from '@nestjs/core'

import { IS_PUBLIC_KEY, Public } from '../../../common/decorators/public.decorator'

/**
 * 全局 JWT 认证守卫：在 app.module 以 APP_GUARD 注册，默认所有接口需要登录。
 * 标记了 @Public() 的路由（登录、刷新令牌等）自动放行。
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super()
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])
    if (isPublic) {
      return true
    }
    return super.canActivate(context)
  }
}

export { Public }
