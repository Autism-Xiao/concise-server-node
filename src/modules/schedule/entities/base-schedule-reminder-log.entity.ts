import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

/** 站内提醒消息记录表 base_schedule_reminder_log（UNIQUE(event_id, user_id) 防重） */
@Entity('base_schedule_reminder_log')
export class BaseScheduleReminderLogEntity {
  @ApiProperty({ description: '主键 ID', example: 1 })
  @PrimaryGeneratedColumn({ type: 'bigint', comment: '主键' })
  id: number

  @ApiProperty({ description: '来源日程 ID' })
  @Column({ type: 'bigint', comment: '来源日程ID' })
  eventId: number

  @ApiProperty({ description: '接收用户 ID' })
  @Column({ type: 'varchar', length: 32, comment: '接收用户ID' })
  userId: string

  @ApiProperty({ description: '消息标题（日程标题）' })
  @Column({ type: 'varchar', length: 200, comment: '消息标题' })
  title: string

  @ApiPropertyOptional({ description: '消息内容', nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true, comment: '消息内容' })
  message: string | null

  @ApiProperty({ description: '是否已读', default: false })
  @Column({ type: 'tinyint', default: 0, comment: '是否已读' })
  isRead: boolean

  @ApiPropertyOptional({ description: '已读时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '已读时间' })
  readAt: Date | null

  @ApiProperty({ description: '推送时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '推送时间' })
  createTime: Date
}
