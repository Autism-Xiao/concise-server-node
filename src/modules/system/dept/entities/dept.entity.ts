import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

@Entity('dept')
export class DeptEntity {
  @ApiProperty({ description: '部门 ID', example: 1 })
  @PrimaryGeneratedColumn()
  id: number

  @ApiProperty({ description: '部门名称', example: '研发部' })
  @Column({ length: 32, comment: '部门名称' })
  name: string

  @ApiProperty({ description: '父级部门 ID，0 为顶级', example: 0 })
  @Column({ type: 'int', default: 0, comment: '父级ID，0为顶级' })
  parentId: number

  @ApiProperty({ description: '排序号，越小越靠前', example: 0 })
  @Column({ type: 'int', default: 0, comment: '排序号' })
  sort: number

  @ApiPropertyOptional({ description: '负责人', example: '张三', nullable: true })
  @Column({ length: 32, nullable: true, comment: '负责人' })
  leader?: string

  @ApiPropertyOptional({ description: '联系电话', example: '13800138000', nullable: true })
  @Column({ length: 20, nullable: true, comment: '联系电话' })
  phone?: string

  @ApiProperty({ description: '状态：0 禁用 / 1 启用', example: 1, enum: [0, 1] })
  @Column({ type: 'tinyint', default: 1, comment: '状态：0禁用 1启用' })
  status: number

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
  createdAt: Date

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at', comment: '更新时间' })
  updatedAt: Date
}
