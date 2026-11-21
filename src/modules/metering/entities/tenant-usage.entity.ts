import { ApiProperty } from '@nestjs/swagger'
import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

/**
 * 租户月度用量汇总（sys_tenant_usage）
 *
 * 共享表 + tenant_id 模式：一行 = 某租户某月某指标的累计值。
 * 写入走 `INSERT ... ON DUPLICATE KEY UPDATE`，天然并发安全，不用先查再写。
 * 这里只记「多少钱/多少量」的原始事实，不做计费规则；套餐换算留给商业化层。
 */
@Entity('sys_tenant_usage')
@Index('uk_tenant_usage_metric', ['tenantId', 'metric', 'period'], { unique: true })
@Index('idx_tenant_usage_period', ['period'])
export class TenantUsageEntity {
  @ApiProperty({ description: '主键 ID' })
  @PrimaryGeneratedColumn({ comment: '主键' })
  id: number

  @ApiProperty({ description: '租户 ID' })
  @Column({ name: 'tenant_id', type: 'int', default: 0, comment: '租户ID' })
  tenantId: number

  @ApiProperty({ description: '指标名，如 api.calls / file.upload.bytes' })
  @Column({ type: 'varchar', length: 64, comment: '指标名' })
  metric: string

  @ApiProperty({ description: '账期 YYYYMM' })
  @Column({ type: 'varchar', length: 6, comment: '账期 YYYYMM' })
  period: string

  @ApiProperty({ description: '累计值（字节类指标单位为字节）' })
  @Column({
    type: 'bigint',
    default: 0,
    transformer: { to: (value: number) => value, from: (value: string | number | null) => Number(value ?? 0) },
    comment: '累计值'
  })
  value: number

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', comment: '更新时间' })
  updatedAt: Date
}
