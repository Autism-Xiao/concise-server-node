import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, PrimaryColumn } from 'typeorm'

/**
 * 数据字典表
 *
 * - 主键 32 位字符串，dict_code 唯一
 * - 字典类型没有「启用/停用」列，只有 del_flag（0 正常 / 1 已删除），本项目保持一致
 * - type：0 string / 1 number，表示该字典下 item_value 的值类型
 */
@Entity('sys_dict')
export class SysDictEntity {
  @ApiProperty({ description: '主键 ID（32 位字符串）' })
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '主键id' })
  id: string

  @ApiProperty({ description: '字典名称', example: '用户性别' })
  @Column({ name: 'dict_name', length: 100, comment: '字典名称' })
  dictName: string

  @ApiProperty({ description: '字典编码（唯一，前端按此取值）', example: 'sys_user_gender' })
  @Column({ name: 'dict_code', length: 100, unique: true, comment: '字典编码' })
  dictCode: string

  @ApiPropertyOptional({ description: '描述', example: '用户性别字典', nullable: true })
  @Column({ length: 255, nullable: true, comment: '描述' })
  description?: string

  @ApiProperty({ description: '删除状态：0 正常 / 1 已删除', example: 0, enum: [0, 1] })
  @Column({ name: 'del_flag', type: 'int', default: 0, comment: '删除状态（0正常 1已删除）' })
  delFlag: number

  @ApiProperty({ description: '字典值类型：0 string / 1 number', example: 0, enum: [0, 1] })
  @Column({ type: 'int', default: 0, comment: '字典类型（0 string / 1 number）' })
  type: number

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

  @ApiPropertyOptional({ description: '字典项数量（列表查询时统计，非表字段）', example: 3 })
  itemCount?: number
}
