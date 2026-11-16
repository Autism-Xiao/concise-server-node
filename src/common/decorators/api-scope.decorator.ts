import { SetMetadata } from '@nestjs/common'

/**
 * 开放接口的 scope 声明
 *
 * 与 @Perms 的分工：@Perms 是「用户持有什么按钮权限」，@ApiScope 是「应用被授予了什么范围」。
 * 同一个接口可以两个都标：用户请求走 @Perms 判定，应用令牌走 @ApiScope 判定，互不干扰。
 */
export const API_SCOPE_KEY = 'apiScope'

/** 声明本接口需要应用令牌持有哪些 scope（任一命中即可访问） */
export const ApiScope = (...scopes: string[]) => SetMetadata(API_SCOPE_KEY, scopes)
