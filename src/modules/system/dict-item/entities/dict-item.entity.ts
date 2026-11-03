import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import { DictTypeEntity } from '../../dict-type/entities/dict-type.entity'

@Entity('dict_item')
export class DictItemEntity {
  @ApiProperty({ description: '字典项 ID', example: 1 })
  @PrimaryGeneratedColumn()
  id: number

  @ApiProperty({ description: '字典标签（展示用）', example: '男' })
  @Column({ length: 32, comment: '字典标签' })
  label: string

  @ApiProperty({ description: '字典值（存储用，同一字典类型下唯一）', example: '1' })
  @Column({ length: 64, comment: '字典值' })
  value: string

  @ApiProperty({ description: '所属字典类型 ID', example: 1 })
  @Column({ name: 'dictTypeId', type: 'int', comment: '所属字典类型ID' })
  dictTypeId: number

  @ApiProperty({ description: '排序号，越小越靠前', example: 0 })
  @Column({ type: 'int', default: 0, comment: '排序号' })
  sort: number

  @ApiProperty({ description: '状态：0 禁用 / 1 启用', example: 1, enum: [0, 1] })
  @Column({ type: 'tinyint', default: 1, comment: '状态：0禁用 1启用' })
  status: number

  @ApiPropertyOptional({ description: '备注', nullable: true })
  @Column({ length: 255, nullable: true, comment: '备注' })
  remark?: string

  @ManyToOne(() => DictTypeEntity, type => type.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dictTypeId' })
  dictType?: DictTypeEntity

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
  createdAt: Date

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at', comment: '更新时间' })
  updatedAt: Date
}
