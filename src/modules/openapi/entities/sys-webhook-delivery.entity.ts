import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, PrimaryColumn } from 'typeorm'

/**
 * Webhook 投递流水：每次派发一行（含重试后的最终结果）
 *
 * 只记"最终成败 + 尝试次数 + 最后一次响应"，不记每次重试的中间态
 * —— 排查「对方说没收到」看这一行就够，再细就要上消息队列了。
 */
@Entity('sys_webhook_delivery')
@Index('idx_delivery_hook', ['webhookId', 'createTime'])
export class SysWebhookDeliveryEntity {
  @ApiProperty({ description: '主键 ID（32 位字符串）' })
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '主键id' })
  id: string

  @ApiProperty({ description: '订阅 ID' })
  @Column({ type: 'varchar', length: 32, name: 'webhook_id', comment: '订阅id' })
  webhookId: string

  @ApiProperty({ description: '事件名', example: 'user.created' })
  @Column({ type: 'varchar', length: 64, comment: '事件名' })
  event: string

  @ApiProperty({ description: '投递结果（0 成功 / 1 失败）' })
  @Column({ type: 'char', length: 1, comment: '投递结果(0成功 1失败)' })
  status: string

  @ApiProperty({ description: '尝试次数（含重试）' })
  @Column({ type: 'int', default: 1, comment: '尝试次数' })
  attempts: number

  @ApiPropertyOptional({ description: '最后一次 HTTP 状态码', nullable: true })
  @Column({ type: 'int', name: 'response_code', nullable: true, comment: '最后一次HTTP状态码' })
  responseCode?: number | null

  @ApiPropertyOptional({ description: '失败原因', nullable: true })
  @Column({ type: 'varchar', length: 500, nullable: true, comment: '失败原因' })
  error?: string | null

  @ApiPropertyOptional({ description: '请求体快照', nullable: true })
  @Column({ type: 'text', nullable: true, comment: '请求体快照' })
  payload?: string | null

  @ApiProperty({ description: '投递时间' })
  @Index('idx_delivery_time')
  @Column({ type: 'datetime', precision: 3, name: 'create_time', comment: '投递时间' })
  createTime: Date
}
