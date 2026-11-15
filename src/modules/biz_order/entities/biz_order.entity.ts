import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

/** 订单（生成器产物，字段调整请连同迁移一起改） */
@Entity('biz_order')
export class BizOrderEntity {
  @ApiProperty({ description: '订单 ID' })
  @PrimaryGeneratedColumn()
  id: number

  @ApiPropertyOptional({ description: '租户 ID（0=平台共享）', example: 1 })
  @Column({ type: 'int', default: 1, comment: '租户ID(0=平台共享)' })
  tenantId?: number

  @ApiPropertyOptional({ description: '标题' })
  @Column({ type: 'varchar', length: 128 })
  title?: string | null

  @ApiPropertyOptional({ description: '状态' })
  @Column({ type: 'tinyint', nullable: true, default: 1 })
  status?: number | null

  @ApiPropertyOptional({ description: '金额' })
  @Column({ type: 'decimal', nullable: true })
  amount?: number | null

  @ApiPropertyOptional({ description: '签约时间' })
  @Column({ type: 'datetime', nullable: true })
  signedAt?: string | null

  @ApiPropertyOptional({ description: '备注' })
  @Column({ type: 'varchar', length: 128, nullable: true })
  remark?: string | null

  @ApiPropertyOptional({ description: '创建人（用户名/账号）', nullable: true })
  @Column({ type: 'varchar', length: 32, nullable: true, comment: '创建人' })
  createBy?: string | null

  @ApiPropertyOptional({ description: '更新人', nullable: true })
  @Column({ type: 'varchar', length: 32, nullable: true, comment: '更新人' })
  updateBy?: string | null

  @ApiPropertyOptional({ description: '删除标记：0 正常 / 1 已删除' })
  @Column({ type: 'tinyint', default: 0, comment: '0正常 1已删除' })
  delFlag: number

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
  createdAt: Date

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at', comment: '更新时间' })
  updatedAt: Date
}
