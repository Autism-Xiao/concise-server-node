import { Module } from '@nestjs/common'

import { RedisService } from './redis.service'

/** Redis 共享模块：需要 Redis 的模块显式 imports 即可拿到 RedisService */
@Module({
  providers: [RedisService],
  exports: [RedisService]
})
export class RedisModule {}
