import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

/** 日程事件表 base_schedule_event（userId 为创建者=提醒接收人，不用 0 表示全局） */
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
