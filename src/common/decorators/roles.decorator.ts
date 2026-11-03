import { SetMetadata } from '@nestjs/common'

/** 声明接口所需角色（角色 name，任一匹配即放行），配合全局 RolesGuard 使用 */
export const ROLES_KEY = 'roles'
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles)
