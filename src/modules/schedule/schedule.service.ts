import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, Repository } from 'typeorm'

import { BaseCalendarEntity } from './entities/base-calendar.entity'
import { BaseScheduleEventEntity } from './entities/base-schedule-event.entity'
import { BaseScheduleReminderLogEntity } from './entities/base-schedule-reminder-log.entity'
import { CreateCalendarDto, UpdateCalendarDto } from './dto/create-calendar.dto'
import { CreateScheduleEventDto, QueryScheduleEventDto, UpdateScheduleEventDto } from './dto/create-event.dto'
import { ReminderScheduler } from './reminder.scheduler'

const DEFAULT_CALENDAR_NAME = '我的日程'
const DEFAULT_CALENDAR_COLOR = '#1890ff'

/**
 * 日历与日程服务：
 * - 可见性：私有日历仅属主可见；公开日历（is_public=1）的事件全员可读，但写操作仅限属主
 * - 提醒：创建/修改时注册；修改涉及时间变化时重置 is_reminded 并重注册；删除同步取消定时器
 */
@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name)

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(BaseCalendarEntity) private readonly calendarRepo: Repository<BaseCalendarEntity>,
    @InjectRepository(BaseScheduleEventEntity) private readonly eventRepo: Repository<BaseScheduleEventEntity>,
    @InjectRepository(BaseScheduleReminderLogEntity) private readonly logRepo: Repository<BaseScheduleReminderLogEntity>,
    private readonly reminderScheduler: ReminderScheduler
  ) {}

  /* ---------------- 日历分类 ---------------- */

  /** 当前用户可见的日历：自己的 + 公开的 */
  async listCalendars(userId: string): Promise<BaseCalendarEntity[]> {
    return this.calendarRepo.find({ where: [{ ownerId: userId }, { isPublic: true }], order: { id: 'ASC' } })
  }

  async createCalendar(userId: string, dto: CreateCalendarDto): Promise<BaseCalendarEntity> {
    const ownerId = dto.ownerId ? dto.ownerId : userId
    const row = this.calendarRepo.create({
      name: dto.name,
      color: dto.color ?? DEFAULT_CALENDAR_COLOR,
      ownerId,
      isPublic: dto.isPublic ?? false,
      createTime: new Date()
    })
    return this.calendarRepo.save(row)
  }

  async updateCalendar(userId: string, id: number, dto: UpdateCalendarDto): Promise<BaseCalendarEntity> {
    const before = await this.calendarRepo.findOne({ where: { id } })
    if (!before) throw new NotFoundException('日历不存在')
    this.assertOwner(before, userId, '日历')
    const patch: Partial<BaseCalendarEntity> = { updateTime: new Date() }
    if (dto.name !== undefined) patch.name = dto.name
    if (dto.color !== undefined) patch.color = dto.color
    if (dto.isPublic !== undefined) patch.isPublic = dto.isPublic
    await this.calendarRepo.update(id, patch)
    return { ...before, ...patch } as BaseCalendarEntity
  }

  /** 删除日历：级联删除其下所有日程并取消未触发的提醒定时器（提醒消息记录保留） */
  async deleteCalendar(userId: string, id: number): Promise<void> {
    const before = await this.calendarRepo.findOne({ where: { id } })
    if (!before) throw new NotFoundException('日历不存在')
    this.assertOwner(before, userId, '日历')

    await this.dataSource.transaction(async manager => {
      const events = await manager.find(BaseScheduleEventEntity, { where: { calendarId: id }, select: { id: true } })
      for (const e of events) this.reminderScheduler.cancel(e.id)
      await manager.delete(BaseScheduleEventEntity, { calendarId: id })
      await manager.delete(BaseCalendarEntity, { id })
    })
    this.logger.log(`日历 ${id} 已删除（级联日程+清定时器），操作人=${userId}`)
  }

  /** 确保用户有默认日历，返回其 id（前端首次添加日程时自动建「我的日程」） */
  async ensureDefaultCalendar(userId: string): Promise<BaseCalendarEntity> {
    const mine = await this.calendarRepo.findOne({ where: { ownerId: userId, name: DEFAULT_CALENDAR_NAME } })
    if (mine) return mine
    const anyMine = await this.calendarRepo.findOne({ where: { ownerId: userId }, order: { id: 'ASC' } })
    if (anyMine) return anyMine
    return this.createCalendar(userId, { name: DEFAULT_CALENDAR_NAME, color: DEFAULT_CALENDAR_COLOR })
  }

  /* ---------------- 日程事件 ---------------- */

  /** 区间查询：我的日历 + 公开日历的事件（供月视图渲染） */
  async listEvents(userId: string, dto: QueryScheduleEventDto): Promise<BaseScheduleEventEntity[]> {
    const visible = await this.calendarRepo.find({ where: [{ ownerId: userId }, { isPublic: true }], select: { id: true } })
    if (visible.length === 0) return []
    const start = dto.startDate ? new Date(dto.startDate) : undefined
    const end = dto.endDate ? this.endOfDay(new Date(dto.endDate)) : undefined

    const qb = this.eventRepo
      .createQueryBuilder('e')
      .where('e.calendarId IN (:...cids)', { cids: visible.map(c => c.id) })
      .orderBy('e.startTime', 'ASC')
      .limit(Math.min(dto.limit ?? 500, 1000))
    if (start) qb.andWhere('e.endTime >= :start', { start })
    if (end) qb.andWhere('e.startTime <= :end', { end })
    if (dto.calendarId) qb.andWhere('e.calendarId = :cid', { cid: dto.calendarId })
    return qb.getMany()
  }

  async getEvent(userId: string, id: number): Promise<BaseScheduleEventEntity> {
    const event = await this.eventRepo.findOne({ where: { id } })
    if (!event) throw new NotFoundException('日程不存在')
    const calendar = await this.calendarRepo.findOne({ where: { id: event.calendarId } })
    if (!calendar) throw new NotFoundException('所属日历不存在')
    if (calendar.ownerId !== userId && !calendar.isPublic) {
      throw new ForbiddenException('无权查看该日程')
    }
    return event
  }

  async createEvent(userId: string, dto: CreateScheduleEventDto): Promise<BaseScheduleEventEntity> {
    const calendar = await this.calendarRepo.findOne({ where: { id: dto.calendarId } })
    if (!calendar) throw new NotFoundException('所属日历不存在')
    if (calendar.ownerId !== userId) throw new ForbiddenException('只能在自己的日历下创建日程')

    const start = new Date(dto.startTime)
    const end = new Date(dto.endTime)
    if (end.getTime() <= start.getTime()) throw new BadRequestException('结束时间必须晚于开始时间')

    const row = await this.eventRepo.save(
      this.eventRepo.create({
        calendarId: dto.calendarId,
        userId: userId,
        title: dto.title,
        startTime: start,
        endTime: end,
        description: dto.description ?? null,
        category: dto.category ?? null,
        remindType: 'SOCKET',
        remindAt: dto.remindAt ? new Date(dto.remindAt) : null,
        isReminded: false,
        createTime: new Date()
      })
    )
    if (row.remindAt) this.reminderScheduler.register(row.id, row.remindAt)
    return row
  }

  /**
   * 修改日程：涉及时间/提醒变化时取消旧定时器、重置 is_reminded、按新时间重注册；
   * remindAt 传 null 表示取消提醒。
   */
  async updateEvent(userId: string, id: number, dto: UpdateScheduleEventDto): Promise<BaseScheduleEventEntity> {
    const before = await this.eventRepo.findOne({ where: { id } })
    if (!before) throw new NotFoundException('日程不存在')
    const calendar = await this.calendarRepo.findOne({ where: { id: before.calendarId } })
    if (!calendar || calendar.ownerId !== userId) throw new ForbiddenException('只能修改自己日历下的日程')

    if (dto.calendarId !== undefined && dto.calendarId !== before.calendarId) {
      const target = await this.calendarRepo.findOne({ where: { id: dto.calendarId } })
      if (!target || target.ownerId !== userId) throw new ForbiddenException('目标日历不存在或不属于你')
    }

    const patch: Partial<BaseScheduleEventEntity> = { updateTime: new Date() }
    if (dto.title !== undefined) patch.title = dto.title
    if (dto.description !== undefined) patch.description = dto.description ?? null
    if (dto.category !== undefined) patch.category = dto.category ?? null
    if (dto.calendarId !== undefined) patch.calendarId = dto.calendarId

    const start = dto.startTime ? new Date(dto.startTime) : before.startTime
    const end = dto.endTime ? new Date(dto.endTime) : before.endTime
    if (end.getTime() <= start.getTime()) throw new BadRequestException('结束时间必须晚于开始时间')
    patch.startTime = start
    patch.endTime = end

    // remindAt: undefined=不变更；null=取消；字符串=新时间
    const remindChanged = dto.remindAt !== undefined
    const nextRemindAt = dto.remindAt === null ? null : dto.remindAt ? new Date(dto.remindAt) : before.remindAt
    if (nextRemindAt) patch.remindAt = nextRemindAt
    else patch.remindAt = null

    const timeChanged = start.getTime() !== before.startTime.getTime() || end.getTime() !== before.endTime.getTime()
    const needReregister = remindChanged || (timeChanged && !!patch.remindAt)
    if (needReregister) patch.isReminded = false

    await this.eventRepo.update(id, patch)
    this.reminderScheduler.cancel(id)
    if (needReregister && patch.remindAt) this.reminderScheduler.register(id, patch.remindAt)

    const after = await this.eventRepo.findOne({ where: { id } })
    return after as BaseScheduleEventEntity
  }

  /** 删除日程：取消提醒定时器，消息记录保留（历史已推送不回滚） */
  async deleteEvent(userId: string, id: number): Promise<void> {
    const before = await this.eventRepo.findOne({ where: { id } })
    if (!before) throw new NotFoundException('日程不存在')
    const calendar = await this.calendarRepo.findOne({ where: { id: before.calendarId } })
    if (!calendar || calendar.ownerId !== userId) throw new ForbiddenException('只能删除自己日历下的日程')
    this.reminderScheduler.cancel(id)
    await this.eventRepo.delete(id)
  }

  /* ---------------- 站内提醒消息 ---------------- */

  async listReminders(userId: string, page: { current: number; size: number; isRead?: boolean }) {
    const qb = this.logRepo.createQueryBuilder('l').where('l.userId = :uid', { uid: userId })
    if (page.isRead !== undefined) qb.andWhere('l.isRead = :r', { r: page.isRead })
    qb.orderBy('l.createTime', 'DESC')
      .limit(page.size)
      .offset((page.current - 1) * page.size)
    const [records, total] = await Promise.all([qb.getMany(), qb.getCount()])
    return { records, total, current: page.current, size: page.size }
  }

  async markRead(userId: string, id: number): Promise<void> {
    const res = await this.logRepo.update({ id, userId: userId }, { isRead: true, readAt: new Date() })
    if (!res.affected) throw new NotFoundException('消息不存在')
  }

  async markAllRead(userId: string): Promise<void> {
    await this.logRepo.update({ userId: userId, isRead: false }, { isRead: true, readAt: new Date() })
  }

  async unreadCount(userId: string): Promise<number> {
    return this.logRepo.count({ where: { userId: userId, isRead: false } })
  }

  /* ---------------- 私有 ---------------- */

  private assertOwner(calendar: BaseCalendarEntity, userId: string, label: string): void {
    if (calendar.ownerId !== userId) throw new ForbiddenException(`只能操作自己的${label}`)
  }

  private endOfDay(d: Date): Date {
    const copy = new Date(d)
    copy.setHours(23, 59, 59, 999)
    return copy
  }
}
