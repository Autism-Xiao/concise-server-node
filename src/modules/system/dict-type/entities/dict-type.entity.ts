import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import { DictItemEntity } from '../../dict-item/entities/dict-item.entity'

@Entity('dict_type')
export class DictTypeEntity {
  @ApiProperty({ description: '字典类型 ID', example: 1 })
  @PrimaryGeneratedColumn()
  id: number

  @ApiProperty({ description: '字典类型名称', example: '用户性别' })
  @Column({ length: 32, comment: '字典类型名称' })
  name: string

  @ApiProperty({ description: '字典类型编码（唯一，前端按此取值）', example: 'sys_user_gender' })
  @Column({ length: 64, unique: true, comment: '字典编码' })
  code: string

  @ApiProperty({ description: '状态：0 禁用 / 1 启用', example: 1, enum: [0, 1] })
  @Column({ type: 'tinyint', default: 1, comment: '状态：0禁用 1启用' })
  status: number

  @ApiPropertyOptional({ description: '备注', example: '性别字典', nullable: true })
  @Column({ length: 255, nullable: true, comment: '备注' })
  remark?: string

  @ApiProperty({ description: '字典项列表', type: [DictItemEntity], required: false })
  @OneToMany(() => DictItemEntity, item => item.dictType)
  items?: DictItemEntity[]

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
  createdAt: Date

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at', comment: '更新时间' })
  updatedAt: Date
}
