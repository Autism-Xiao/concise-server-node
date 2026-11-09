import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { PERMS_KEY } from '../decorators/perms.decorator'
import { PermissionCacheService } from '../../shared/permission-cache/permission-cache.service'

/**
 * 全局按钮级权限守卫：读取 @Perms() 声明，校验用户是否持有该权限标识
 *
 * 权限集合来自 PermissionCacheService（按角色缓存 5 分钟 + 写侧主动失效）：
 *  - 角色授权、角色删除、菜单权限改动都会立刻失效，改完权限下一次请求即生效；
 *  - Redis 不可用时自动降级为实时查库，不影响鉴权正确性。
 *
 * 两条放行/拦截规则：
 *  - **平台级权限**（sys_permission.scope='platform'，如 system:tenant:*、system:menu:*、运维监控）
 *    除了持有权限码，还必须是平台管理员 —— 否则租户管理员给自己授个权就能建/删租户；
 *  - 平台管理员（sys_user.is_platform_admin=1）拥有全部权限，与 RolesGuard 共用同一判定。
 *
 * 注意：这里**不再**按 role_code 判断超管。sys_role 是租户级表，按编码判定会把租户管理员提升成平台超管。
 * 未声明 @Perms() 的接口不受限。
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
    const isPlatformAdmin = Number(user?.isPlatformAdmin ?? 0) === 1

    // 平台级权限前置拦截：先判作用域，再判是否持有（给租户管理员一个说得清的原因，而不是笼统的「无权限」）
    if (!isPlatformAdmin) {
      const platformPerms = await this.permissionCache.getPlatformPerms()
      const blocked = required.find(perm => platformPerms.has(perm))
      if (blocked) {
        throw new ForbiddenException(`「${blocked}」是平台级权限，仅平台管理员可操作`)
      }
    }

    if (isPlatformAdmin) {
      return true
    }

    const roles = user?.roles ?? []
    if (roles.length === 0) {
      throw new ForbiddenException('无操作权限')
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
