import { Global, Module } from '@nestjs/common'

import { RedisModule } from '../redis/redis.module'
import { RateLimitService } from './rate-limit.service'

/**
 * 计数模块（全局）：限流守卫与登录失败锁定都需要它
 * 设为 @Global 是为了让 APP_GUARD 在任意模块上下文都能注入，避免每个模块重复 imports
 */
@Global()
@Module({
  imports: [RedisModule],
  providers: [RateLimitService],
  exports: [RateLimitService]
})
export class RateLimitModule {}
