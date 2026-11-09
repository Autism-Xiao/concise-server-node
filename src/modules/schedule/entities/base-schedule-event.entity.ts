import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

/**
 * 日程事件表 base_schedule_event（userId 为创建者=提醒接收人，不用 0 表示全局）
 *
 * **多租户决策：日程跟随人，不按租户隔离（刻意不加 tenant_id）**
 * - 日程是用户自己写的个人事务（会议、私事），不是「租户的业务资产」，租户管理员没有理由看到；
 * - 加 tenant_id 会让同一个人在 A、B 两个租户的日程被切成两套，切租户就"丢日程"；
 * - 与 sys_user_setting / sys_user_watermark 同类：偏好和私人数据跟人走。
 * 访问控制靠 userId = 当前登录人，已经是比租户更细的隔离。
 * 如果将来产品要求「日程也按租户分区」，需要同时改 base_calendar / base_schedule_reminder_log
 * 和提醒调度器（scheduler 里按租户上下文跑），不要只给事件表加列。
 */
@Entity('base_schedule_event')
export class BaseScheduleEventEntity {
  @ApiProperty({ description: '主键 ID', example: 1 })
  @PrimaryGeneratedColumn({ type: 'bigint', comment: '主键' })
  id: number

  @ApiProperty({ description: '所属日历 ID' })
  @Column({ type: 'bigint', comment: '所属日历ID' })
  calendarId: number

  @ApiProperty({ description: '创建者用户 ID（提醒接收人）' })
  @Column({ type: 'varchar', length: 32, comment: '创建者用户ID' })
  userId: string

  @ApiProperty({ description: '日程标题', example: '产品评审会' })
  @Column({ type: 'varchar', length: 200, comment: '日程标题' })
  title: string

  @ApiProperty({ description: '开始时间', example: '2026-11-10 09:00:00' })
  @Column({ type: 'datetime', comment: '开始时间' })
  startTime: Date

  @ApiProperty({ description: '结束时间', example: '2026-11-10 10:00:00' })
  @Column({ type: 'datetime', comment: '结束时间' })
  endTime: Date

  @ApiPropertyOptional({ description: '描述', nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true, comment: '描述' })
  description: string | null

  @ApiPropertyOptional({ description: '标签：会议/待办/维护 等', example: '会议', nullable: true })
  @Column({ type: 'varchar', length: 50, nullable: true, comment: '标签' })
  category: string | null

  @ApiProperty({ description: '提醒方式（当前仅 SOCKET=站内消息）', default: 'SOCKET' })
  @Column({ type: 'varchar', length: 20, default: 'SOCKET', comment: '提醒方式' })
  remindType: string

  @ApiPropertyOptional({ description: '提醒触发时间点（空=不提醒）', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '提醒触发时间点' })
  remindAt: Date | null

  @ApiProperty({ description: '是否已提醒（幂等标记）', default: false })
  @Column({ type: 'tinyint', default: 0, comment: '是否已提醒' })
  isReminded: boolean

  @ApiProperty({ description: '创建时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '创建时间' })
  createTime: Date

  @ApiProperty({ description: '更新时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '更新时间' })
  updateTime: Date
}
