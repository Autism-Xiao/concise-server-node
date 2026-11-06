import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { BaseCalendarEntity } from './entities/base-calendar.entity'
import { BaseScheduleEventEntity } from './entities/base-schedule-event.entity'
import { BaseScheduleReminderLogEntity } from './entities/base-schedule-reminder-log.entity'
import { ReminderV1Controller } from './reminder.v1.controller'
import { ReminderScheduler } from './reminder.scheduler'
import { ScheduleService } from './schedule.service'
import { ScheduleV1Controller } from './schedule.v1.controller'

@Module({
  imports: [TypeOrmModule.forFeature([BaseCalendarEntity, BaseScheduleEventEntity, BaseScheduleReminderLogEntity])],
  controllers: [ScheduleV1Controller, ReminderV1Controller],
  providers: [ScheduleService, ReminderScheduler],
  exports: [ReminderScheduler]
})
export class ScheduleModule {}
