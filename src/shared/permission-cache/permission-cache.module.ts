import { Global, Module } from '@nestjs/common'

import { RedisModule } from '../redis/redis.module'
import { PermissionCacheService } from './permission-cache.service'

/**
 * 权限缓存模块（全局）
 *
 * 声明为 @Global 的原因：PermsGuard 是全局守卫，它在 app.module 里注册；
 * 而缓存失效点分散在角色、菜单等多个业务模块里。做成全局模块后，
 * 各业务模块直接用构造注入即可，不必每个 module 都补一条 imports。
 */
@Global()
@Module({
  imports: [RedisModule],
  providers: [PermissionCacheService],
  exports: [PermissionCacheService]
})
export class PermissionCacheModule {}
