import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { ROLES_KEY } from '../decorators/roles.decorator'

/**
 * 全局角色守卫：读取 @Roles() 声明，与 req.user.roles 匹配（任一命中即放行）
 * 平台管理员（sys_user.is_platform_admin=1）直接放行：其权限来自内置规则，不依赖角色绑定
 *
 * 注意：这里**不按 role_code 判断超管** —— sys_role 是租户级表，按编码判断会把
 * 租户管理员提升成平台超管。租户管理员仍然按自己的角色编码匹配 @Roles('admin')。
 *
 * 业务模块的读写权限请用 @Perms('system:xxx:list/add/update/delete')。
 * 类级 @Roles('admin') 会在本守卫提前返回失败，短路方法级 @Perms，导致角色授权完全失效。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest()
    // 平台管理员先放行：与 auth.service.getPermissions、PermsGuard 保持同一判定
    if (Number(user?.isPlatformAdmin ?? 0) === 1) {
      return true
    }

    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()])
    if (!required || required.length === 0) {
      return true
    }
    const userRoles: string[] = (user?.roles ?? [])
      .map((role: { roleCode?: string }) => role?.roleCode)
      .filter((code: string | undefined): code is string => !!code)
    if (required.some(role => userRoles.includes(role))) {
      return true
    }
    // 不 return false：Nest 会抛默认的 "Forbidden resource"，日志里看不出缺哪个角色
    throw new ForbiddenException(`当前账号角色（${userRoles.join('、') || '无角色'}）无权访问该接口，需要角色：${required.join(' 或 ')}`)
  }
}
