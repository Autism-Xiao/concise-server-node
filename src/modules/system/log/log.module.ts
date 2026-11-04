import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { SysLogEntity } from './entities/sys-log.entity'
import { LogV1Controller } from './log.v1.controller'
import { LogService } from './log.service'

/** 日志模块：被 AuthModule（登录日志）和全局 OperLogInterceptor 共同使用 */
@Module({
  imports: [TypeOrmModule.forFeature([SysLogEntity])],
  controllers: [LogV1Controller],
  providers: [LogService],
  exports: [LogService]
})
export class LogModule {}
