import { SetMetadata } from '@nestjs/common'

/** 标记接口为公开路由，跳过全局 JwtAuthGuard（如登录、刷新令牌） */
export const IS_PUBLIC_KEY = 'isPublic'
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
