import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, PrimaryColumn } from 'typeorm'

/**
 * 职级表（无对应原表，按同风格自建 sys_level）
 * - 主键 32 位字符串；level_name 唯一（P6 / M1 / T3 ...）
 * - level_rank 数字越大级别越高；status varchar：'1' 正常 / '0' 停用（沿用既有惯例）
 */
@Entity('sys_level')
export class LevelEntity {
  @ApiProperty({ description: '主键 ID（32 位字符串）' })
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '主键id' })
  id: string

  @ApiProperty({ description: '职级名称（如 P6 / M1）', example: 'P6' })
  @Column({ length: 100, unique: true, comment: '职级名称' })
  levelName: string

  @ApiProperty({ description: '等级数值，数字越大级别越高', example: 6 })
  @Column({ type: 'int', default: 0, comment: '等级数值，数字越大级别越高' })
  levelRank: number

  @ApiPropertyOptional({ description: '状态：1 正常 / 0 停用', example: '1', nullable: true })
  @Column({ length: 1, default: '1', comment: '状态（1正常，0停用）' })
  status?: string

  @ApiPropertyOptional({ description: '备注', nullable: true })
  @Column({ length: 500, nullable: true, comment: '备注' })
  remark?: string

  @ApiPropertyOptional({ description: '创建人', nullable: true })
  @Column({ length: 32, nullable: true, comment: '创建人' })
  createBy?: string

  @ApiPropertyOptional({ description: '创建时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '创建时间' })
  createTime?: Date

  @ApiPropertyOptional({ description: '更新人', nullable: true })
  @Column({ length: 32, nullable: true, comment: '更新人' })
  updateBy?: string

  @ApiPropertyOptional({ description: '更新时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '更新时间' })
  updateTime?: Date

  @ApiPropertyOptional({ description: '租户 ID（默认 0）', example: 0, nullable: true })
  @Column({ type: 'int', default: 0, comment: '租户ID' })
  tenantId?: number
}
