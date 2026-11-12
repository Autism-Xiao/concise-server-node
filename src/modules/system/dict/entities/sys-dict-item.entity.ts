import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm'

import { SysDictEntity } from './sys-dict.entity'

/**
 * 数据字典条目表
 *
 * - dict_id 关联 sys_dict.id；同一字典下 item_value 唯一（Service 层校验）
 * - status：1 启用 / 0 不启用
 */
@Entity('sys_dict_item')
export class SysDictItemEntity {
  @ApiProperty({ description: '主键 ID（32 位字符串）' })
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '主键id' })
  id: string

  @ApiProperty({ description: '所属字典 ID（sys_dict.id）', example: 'dict_1' })
  @Column({ name: 'dict_id', type: 'varchar', length: 32, comment: '字典id' })
  dictId: string

  @ApiProperty({ description: '字典项文本（展示用）', example: '男' })
  @Column({ name: 'item_text', length: 100, comment: '字典项文本' })
  itemText: string

  @ApiProperty({ description: '字典项值（存储用，同一字典下唯一）', example: '1' })
  @Column({ name: 'item_value', length: 100, comment: '字典项值' })
  itemValue: string

  @ApiPropertyOptional({ description: '描述', nullable: true })
  @Column({ length: 255, nullable: true, comment: '描述' })
  description?: string

  @ApiPropertyOptional({ description: '排序，越小越靠前', example: 1 })
  @Column({ name: 'sort_order', type: 'int', default: 0, comment: '排序' })
  sortOrder?: number

  @ApiProperty({ description: '状态：1 启用 / 0 不启用', example: 1, enum: [0, 1] })
  @Column({ type: 'int', default: 1, comment: '状态（1启用 0不启用）' })
  status: number

  @ApiPropertyOptional({ description: '创建人', nullable: true })
  @Column({ name: 'create_by', length: 32, nullable: true, comment: '创建人' })
  createBy?: string

  @ApiPropertyOptional({ description: '创建时间', nullable: true })
  @Column({ name: 'create_time', type: 'datetime', nullable: true, comment: '创建时间' })
  createTime?: Date

  @ApiPropertyOptional({ description: '更新人', nullable: true })
  @Column({ name: 'update_by', length: 32, nullable: true, comment: '更新人' })
  updateBy?: string

  @ApiPropertyOptional({ description: '更新时间', nullable: true })
  @Column({ name: 'update_time', type: 'datetime', nullable: true, comment: '更新时间' })
  updateTime?: Date

  @ApiPropertyOptional({ description: '租户 ID（默认 0）', example: 0 })
  @Column({ name: 'tenant_id', type: 'int', default: 0, comment: '租户ID' })
  tenantId?: number

  @ApiPropertyOptional({ description: '所属字典（详情/列表查询时带出）', type: SysDictEntity, nullable: true })
  @ManyToOne(() => SysDictEntity, { nullable: false, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'dict_id' })
  dict?: SysDictEntity
}
