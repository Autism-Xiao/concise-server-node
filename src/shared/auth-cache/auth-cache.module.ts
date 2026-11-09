import { Global, Module } from '@nestjs/common'

import { AuthUserCacheService } from './auth-user-cache.service'

/**
 * 鉴权用户缓存模块
 *
 * 全局模块：JwtStrategy（auth）写缓存，UserService / RoleService（业务侧）负责失效，
 * 两侧都需要同一个实例，而它们分属不同模块 —— 走 @Global 避免到处 imports。
 */
@Global()
@Module({
  providers: [AuthUserCacheService],
  exports: [AuthUserCacheService]
})
export class AuthCacheModule {}
