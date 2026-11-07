import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

@Entity('task')
export class TaskEntity {
  @ApiProperty({ description: '任务 ID', example: 1 })
  @PrimaryGeneratedColumn()
  id: number

  @ApiPropertyOptional({ description: '租户 ID（0=平台共享）', example: 1 })
  @Column({ type: 'int', default: 1, comment: '租户ID(0=平台共享)' })
  tenantId?: number

  @ApiProperty({ description: '任务标题', example: '整理需求文档' })
  @Column({ length: 64, comment: '任务标题' })
  title: string

  @ApiPropertyOptional({ description: '任务描述', nullable: true })
  @Column({ type: 'text', nullable: true, comment: '任务描述' })
  description?: string

  @ApiProperty({ description: '优先级：0 低 / 1 中 / 2 高', example: 1, enum: [0, 1, 2] })
  @Column({ type: 'tinyint', default: 1, comment: '优先级：0低 1中 2高' })
  priority: number

  @ApiProperty({ description: '状态：0 待处理 / 1 进行中 / 2 已完成 / 3 已取消', example: 0, enum: [0, 1, 2, 3] })
  @Column({ type: 'tinyint', default: 0, comment: '状态：0待处理 1进行中 2已完成 3已取消' })
  status: number

  @ApiPropertyOptional({ description: '负责人用户 ID，0 为未指派', example: 1 })
  @Column({ type: 'int', default: 0, comment: '负责人用户ID，0为未指派' })
  assigneeId: number

  @ApiPropertyOptional({ description: '截止时间', example: '2026-12-01T00:00:00.000Z', nullable: true })
  @Column({ name: 'due_date', type: 'datetime', nullable: true, comment: '截止时间' })
  dueDate?: Date | null

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
  createdAt: Date

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at', comment: '更新时间' })
  updatedAt: Date
}
