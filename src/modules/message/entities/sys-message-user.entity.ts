import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/** 用户消息关联：一条消息 × 一个接收人一行，已读状态挂在这里 */
@Index('uk_message_user', ['messageId', 'userId'], { unique: true })
@Index('idx_message_user_user', ['userId', 'isRead'])
@Entity('sys_message_user')
export class SysMessageUserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ length: 64, comment: '消息ID' })
  messageId: string

  @Column({ length: 32, comment: '接收人用户ID' })
  userId: string

  /** 0 未读 / 1 已读 */
  @Column({ type: 'tinyint', default: 0, comment: '0未读 1已读' })
  isRead: number

  @Column({ name: 'read_at', type: 'datetime', nullable: true, comment: '阅读时间' })
  readAt?: Date | null

  @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
  createdAt: Date
}
