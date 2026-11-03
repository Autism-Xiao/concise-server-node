import { SetMetadata } from '@nestjs/common'

/** 按钮级权限标识的 metadata key */
export const PERMS_KEY = 'perms'

/**
 * 声明接口所需的按钮级权限（如 'system:user:add'）
 * 配合全局 PermsGuard 使用：请求用户任一角色挂载的菜单/按钮 permission
 * 命中其中之一即放行；admin 角色默认拥有全部权限
 */
export const Perms = (...perms: string[]) => SetMetadata(PERMS_KEY, perms)
