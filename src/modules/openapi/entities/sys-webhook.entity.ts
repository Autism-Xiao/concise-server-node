import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, PrimaryColumn } from 'typeorm'

/**
 * Webhook 订阅：一个 URL 订一个事件（不做"一个 URL 订多事件"，过滤逻辑放订阅方更直观）
 *
 * secret 是 HMAC-SHA256 签名密钥：接收方要拿它验签，与发送方共享，
 * 所以必须能从库里读出（与 client_secret 的"只存哈希"不同）。
 * URL 只接受 https —— 明文 http 会把签名密钥的验证场景暴露在中间人面前。
 */
@Entity('sys_webhook')
export class SysWebhookEntity {
  @ApiProperty({ description: '主键 ID（32 位字符串）' })
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '主键id' })
  id: string

  @ApiProperty({ description: '租户 ID（0=平台级）' })
  @Column({ type: 'int', default: 0, name: 'tenant_id', comment: '租户ID(0=平台级)' })
  tenantId: number

  @ApiPropertyOptional({ description: '所属应用 ID（空=平台级订阅）', nullable: true })
  @Column({ type: 'varchar', length: 32, name: 'app_id', nullable: true, comment: '所属应用' })
  appId?: string | null

  @ApiProperty({ description: '订阅事件', example: 'user.created' })
  @Column({ type: 'varchar', length: 64, comment: '订阅事件' })
  event: string

  @ApiProperty({ description: '回调地址（仅 https）' })
  @Column({ type: 'varchar', length: 500, comment: '回调地址(仅https)' })
  url: string

  @ApiProperty({ description: 'HMAC-SHA256 签名密钥' })
  @Column({ type: 'varchar', length: 64, comment: 'HMAC-SHA256签名密钥' })
  secret: string

  @ApiProperty({ description: '状态（0 启用 / 1 停用）', example: '0' })
  @Column({ type: 'char', length: 1, default: '0', comment: '状态(0启用 1停用)' })
  status: string

  @Column({ type: 'char', length: 1, default: '0', name: 'del_flag', comment: '删除标志(0存在 1删除)' })
  delFlag: string

  @ApiProperty({ description: '创建时间' })
  @Column({ type: 'datetime', precision: 3, name: 'create_time', comment: '创建时间' })
  createTime: Date

  @ApiPropertyOptional({ description: '更新时间', nullable: true })
  @Column({ type: 'datetime', precision: 3, name: 'update_time', nullable: true, comment: '更新时间' })
  updateTime?: Date | null
}
