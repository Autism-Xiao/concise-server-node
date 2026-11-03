import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { LoginLogEntity } from './entities/login-log.entity'
import { OperLogEntity } from './entities/oper-log.entity'
import { LogController } from './log.controller'
import { LogService } from './log.service'

/** 日志模块：被 AuthModule（登录日志）和全局 OperLogInterceptor 共同使用 */
@Module({
  imports: [TypeOrmModule.forFeature([LoginLogEntity, OperLogEntity])],
  controllers: [LogController],
  providers: [LogService],
  exports: [LogService]
})
export class LogModule {}
