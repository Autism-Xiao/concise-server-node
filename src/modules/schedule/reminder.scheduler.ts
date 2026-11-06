import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { CronJob } from 'cron'
import { EventEmitter } from 'node:events'
import { LessThanOrEqual, MoreThan, Repository } from 'typeorm'

import { BaseScheduleEventEntity } from './entities/base-schedule-event.entity'
import { BaseScheduleReminderLogEntity } from './entities/base-schedule-reminder-log.entity'

export const REMIND_EVENT_NAME = 'schedule.remind.triggered'

/** 巡逻周期：每 3 分钟（兜底进程重启后丢失的内存定时器） */
const PATROL_CRON = '*/3 * * * *'
/** 启动恢复时最多恢复的未触发提醒数（防止超大积压一次性注册过多定时器，超出部分交给巡逻逐轮消化） */
const RESTORE_LIMIT = 2000

/**
 * 提醒调度器：
 * - 内存 setTimeout 负责准点触发（一次性）
 * - 每 3 分钟 cron 巡逻补发 is_reminded=0 且已过期的提醒（进程重启兜底）
 * - 触发用「抢权式 UPDATE」保证幂等：定时器与巡逻并发时只有一方能抢到 affected=1
 * - 抢到权后：站内消息落库（UNIQUE(event_id,user_id) 兜底）+ 抛事件（业务侧可监听做 WebSocket 等）
 */
@Injectable()
export class ReminderScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReminderScheduler.name)
  private readonly timers = new Map<number, NodeJS.Timeout>()
  private readonly cronJob = new CronJob(PATROL_CRON, () => void this.patrol(true))
  readonly emitter = new EventEmitter()

  constructor(
    @InjectRepository(BaseScheduleEventEntity) private readonly eventRepo: Repository<BaseScheduleEventEntity>,
    @InjectRepository(BaseScheduleReminderLogEntity) private readonly logRepo: Repository<BaseScheduleReminderLogEntity>
  ) {}

  async onModuleInit(): Promise<void> {
    this.cronJob.start()
    // 启动恢复：把未来的提醒重新挂上内存定时器；已过期的留给首次巡逻
    const upcoming = await this.eventRepo.find({
      where: { isReminded: false, remindAt: MoreThan(new Date()) },
      select: { id: true, remindAt: true },
      take: RESTORE_LIMIT
    })
    for (const e of upcoming) this.register(e.id, e.remindAt as Date)
    this.logger.log(`提醒恢复完成：注册 ${upcoming.length} 个未来提醒`)
    await this.patrol(false)
  }

  onModuleDestroy(): void {
    this.cronJob.stop()
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }

  /** 注册（或重注册）一次性提醒定时器；remindAt 已过期则立即触发 */
  register(eventId: number, remindAt: Date): void {
    this.cancel(eventId)
    const delay = remindAt.getTime() - Date.now()
    if (delay <= 0) {
      void this.trigger(eventId)
      return
    }
    // 上限保护：setTimeout 超过 2^31-1 会溢出，超过 24 天的提醒交给巡逻兜底
    const timer =
      delay > 2_147_000_000 ? setTimeout(() => void this.trigger(eventId), 2_147_000_000) : setTimeout(() => void this.trigger(eventId), delay + 200)
    timer.unref?.()
    this.timers.set(eventId, timer)
  }

  /** 取消提醒定时器（修改/删除日程时调用） */
  cancel(eventId: number): void {
    const timer = this.timers.get(eventId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(eventId)
    }
  }

  /** 兜底巡逻：补发所有已到期但未提醒的日程 */
  async patrol(logMissed: boolean): Promise<number> {
    const missed = await this.eventRepo.find({
      where: { isReminded: false, remindAt: LessThanOrEqual(new Date()) },
      select: { id: true },
      take: 500
    })
    let sent = 0
    for (const e of missed) {
      if (await this.trigger(e.id)) sent++
    }
    if (logMissed && missed.length > 0) this.logger.warn(`巡逻补发 ${sent}/${missed.length} 条到期提醒`)
    return sent
  }

  /**
   * 触发一次提醒（幂等）：抢权式 UPDATE，affected=1 的一方负责落库+抛事件。
   * @returns 是否由本次调用抢到触发权
   */
  async trigger(eventId: number): Promise<boolean> {
    const claim = await this.eventRepo
      .createQueryBuilder()
      .update(BaseScheduleEventEntity)
      .set({ isReminded: true })
      .where('id = :id AND is_reminded = 0', { id: eventId })
      .execute()
    if (!claim.affected) return false // 已被其他路径触发（定时器/巡逻并发）

    const event = await this.eventRepo.findOne({ where: { id: eventId } })
    if (!event) return true

    const message = `日程提醒：${event.title}（${this.formatTime(event.startTime)} 开始）`
    // UNIQUE(event_id,user_id) 兜底防重；同键重复写入走更新（重置未读，重提醒场景）
    await this.logRepo
      .createQueryBuilder()
      .insert()
      .into(BaseScheduleReminderLogEntity)
      .values({
        eventId,
        userId: event.userId,
        title: event.title,
        message,
        isRead: false
      })
      .orIgnore()
      .execute()

    // 抛事件给业务侧（WebSocket 实时推送等）；当前底座自身消息已落库，无监听者也不影响
    this.emitter.emit(REMIND_EVENT_NAME, {
      eventId,
      userId: event.userId,
      title: event.title,
      message,
      remindType: event.remindType,
      startTime: event.startTime
    })
    this.logger.log(`提醒已触发 eventId=${eventId} userId=${event.userId} title=${event.title}`)
    return true
  }

  private formatTime(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }
}
