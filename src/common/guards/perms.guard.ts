import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { PERMS_KEY } from '../decorators/perms.decorator'
import { hasSuperRole } from '../../utils/super-role.util'
import { PermissionCacheService } from '../../shared/permission-cache/permission-cache.service'

/**
 * 全局按钮级权限守卫：读取 @Perms() 声明，校验用户是否持有该权限标识
 *
 * 权限集合来自 PermissionCacheService（按角色缓存 5 分钟 + 写侧主动失效）：
 *  - 角色授权、角色删除、菜单权限改动都会立刻失效，改完权限下一次请求即生效；
 *  - Redis 不可用时自动降级为实时查库，不影响鉴权正确性。
 *
 * admin 角色直接放行；未声明 @Perms() 的接口不受限。
 */
@Injectable()
export class PermsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionCache: PermissionCacheService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMS_KEY, [context.getHandler(), context.getClass()])
    if (!required || required.length === 0) {
      return true
    }

    const { user } = context.switchToHttp().getRequest()
    const roles = user?.roles ?? []
    if (roles.length === 0) {
      throw new ForbiddenException('无操作权限')
    }

    // 超管角色拥有全部按钮权限（与 auth.service / RolesGuard 共用同一判定）
    if (hasSuperRole(roles)) {
      return true
    }

    const roleIds = roles.map((role: { id: string }) => role.id)
    // 走缓存：角色 → sys_role_permission → sys_permission.perms（无效/已删除菜单不算数）
    const owned = await this.permissionCache.getRolesPerms(roleIds)

    if (required.some(perm => owned.has(perm))) {
      return true
    }
    throw new ForbiddenException('无操作权限')
  }
}
