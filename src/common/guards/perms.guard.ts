import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { DataSource } from 'typeorm'

import { PERMS_KEY } from '../decorators/perms.decorator'
import { hasSuperRole } from '../../utils/super-role.util'

/** 权限标识实体的最小结构（避免守卫直接依赖业务实体造成循环） */
interface PermRow {
  perms: string | null
}

/**
 * 全局按钮级权限守卫：读取 @Perms() 声明，实时查库获取
 * 请求用户所有角色挂载的 menu.permission 集合，任一命中即放行
 * admin 角色直接放行；未声明 @Perms() 的接口不受限
 */
@Injectable()
export class PermsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource
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
    // 实时查库：角色 → sys_role_permission → sys_permission.perms（无效/已删除菜单不算数）
    const rows = await this.dataSource
      .createQueryBuilder()
      .select('p.perms', 'perms')
      .from('sys_permission', 'p')
      .innerJoin('sys_role_permission', 'rp', 'rp.permission_id = p.id')
      .where('rp.role_id IN (:...roleIds)', { roleIds })
      .andWhere("p.status = '1'")
      .andWhere('p.del_flag = 0')
      .getRawMany<PermRow>()

    const owned = new Set(rows.map(row => row.perms).filter((p): p is string => !!p))
    if (required.some(perm => owned.has(perm))) {
      return true
    }
    throw new ForbiddenException('无操作权限')
  }
}
