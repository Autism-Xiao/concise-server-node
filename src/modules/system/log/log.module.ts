import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { RedisModule } from '../../../shared/redis/redis.module'
import { SysLogChangeEntity } from './entities/log-change.entity'
import { SysLogEntity } from './entities/sys-log.entity'
import { ChangeLogService } from './change-log.service'
import { LogV1Controller } from './log.v1.controller'
import { LogService } from './log.service'

/**
 * 日志模块：被 AuthModule（登录日志）和全局 OperLogInterceptor 共同使用
 *
 * `ChangeLogService` 在 onModuleInit 里把自己注册成字段级变更的采集落点，
 * 所以它必须随模块正常实例化 —— 不要改成 lazy provider。
 * RedisModule 给审计哈希链提供跨实例串行锁（同租户并发写日志时 prev 不分叉）。
 */
@Module({
  imports: [TypeOrmModule.forFeature([SysLogEntity, SysLogChangeEntity]), RedisModule],
  controllers: [LogV1Controller],
  providers: [LogService, ChangeLogService],
  exports: [LogService, ChangeLogService]
})
export class LogModule {}
