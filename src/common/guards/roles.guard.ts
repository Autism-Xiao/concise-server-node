import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { ROLES_KEY } from '../decorators/roles.decorator'

/** 全局角色守卫：读取 @Roles() 声明，与 req.user.roles 匹配（任一命中即放行） */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()])
    if (!required || required.length === 0) {
      return true
    }
    const { user } = context.switchToHttp().getRequest()
    const userRoles: string[] = user?.roles?.map((role: { name: string }) => role.name) ?? []
    return required.some(role => userRoles.includes(role))
  }
}
