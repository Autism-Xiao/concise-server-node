import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { RedisModule } from '../../../shared/redis/redis.module'
import { SysQuartzJobEntity } from './entities/sys-quartz-job.entity'
import { JobHandlerRegistry } from './job.handlers'
import { JobScheduler } from './job.scheduler'
import { JobService } from './job.service'
import { JobV1Controller } from './job.v1.controller'

/** 定时任务模块：sys_quartz_job（沿用原表）+ cron 动态调度 */
@Module({
  imports: [TypeOrmModule.forFeature([SysQuartzJobEntity]), RedisModule],
  controllers: [JobV1Controller],
  providers: [JobHandlerRegistry, JobScheduler, JobService],
  exports: [JobHandlerRegistry, JobService]
})
export class JobModule {}
