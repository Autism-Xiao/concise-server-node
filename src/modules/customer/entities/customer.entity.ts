import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

/** 客户（生成器产物，字段调整请连同迁移一起改） */
@Entity('customer')
export class CustomerEntity {
  @ApiProperty({ description: '客户 ID' })
  @PrimaryGeneratedColumn()
  id: number

  @ApiPropertyOptional({ description: '租户 ID（0=平台共享）', example: 1 })
  @Column({ type: 'int', default: 1, comment: '租户ID(0=平台共享)' })
  tenantId?: number

  @ApiPropertyOptional({ description: '客户名称' })
  @Column({ type: 'varchar', length: 128 })
  name?: string | null

  @ApiPropertyOptional({ description: '联系人' })
  @Column({ type: 'varchar', length: 128, nullable: true })
  contact?: string | null

  @ApiPropertyOptional({ description: '电话，唯一键 (电话 按租户唯一)' })
  @Column({ type: 'varchar', length: 128, nullable: true })
  phone?: string | null

  @ApiPropertyOptional({ description: '级别' })
  @Column({ type: 'tinyint', nullable: true, default: 1 })
  level?: number | null

  @ApiPropertyOptional({ description: '客户等级' })
  @Column({ type: 'tinyint', nullable: true })
  vip?: number | null

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
