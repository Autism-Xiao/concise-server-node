import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

/** 消息类型（预留扩展，当前底座内置 send 手动发送 / system 系统通知） */
export const MESSAGE_TYPES = ['send', 'system'] as const
export type MessageType = (typeof MESSAGE_TYPES)[number]

@Entity('sys_message')
export class SysMessageEntity {
  @ApiProperty({ description: '消息 ID', example: '1940123456789012345' })
  @PrimaryGeneratedColumn('uuid')
  id: string

  @ApiProperty({ description: '标题', example: '系统维护通知' })
  @Column({ length: 128, comment: '标题' })
  title: string

  @ApiProperty({ description: '正文' })
  @Column({ type: 'text', comment: '正文' })
  content: string

  @ApiProperty({ description: '消息类型：send 手动发送 / system 系统通知', example: 'send' })
  @Column({ length: 16, default: 'send', comment: '消息类型：send/system' })
  msgType: string

  @ApiPropertyOptional({ description: '发送人用户 ID（系统通知为 NULL）', nullable: true })
  @Column({ type: 'varchar', length: 32, nullable: true, comment: '发送人用户ID' })
  senderId?: string | null

  @ApiPropertyOptional({ description: '租户 ID（0=平台共享）', example: 1 })
  @Column({ type: 'int', default: 1, comment: '租户ID(0=平台共享)' })
  tenantId?: number

  @ApiProperty({ description: '接收人数' })
  @Column({ type: 'int', default: 0, comment: '接收人数' })
  receiverCount: number

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
  createdAt: Date

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at', comment: '更新时间' })
  updatedAt: Date
}
