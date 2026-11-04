import { Module } from '@nestjs/common'

import { RedisModule } from '../../../shared/redis/redis.module'
import { OnlineService } from './online.service'
import { OnlineV1Controller } from './online.v1.controller'

/** 在线用户模块：会话存 Redis（不建表，与 JeecgBoot 一致），同时被 AuthModule 复用作令牌黑名单 */
@Module({
  imports: [RedisModule],
  controllers: [OnlineV1Controller],
  providers: [OnlineService],
  exports: [OnlineService]
})
export class OnlineModule {}
