import { ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, PrimaryColumn } from 'typeorm'

/**
 * 用户级页面水印配置
 *
 * 三处可空字段（enabled / content / density）用 NULL 表示「继承全局」：
 * admin 调整全局默认时，没主动设置过的用户会自动跟随，不需要批量刷全表。
 *
 * enforced 是强管控档，只有管理员能改：
 *  - 0 不强制（用户可按全局策略自行开关）
 *  - 1 强制开启（用户关不掉）
 *  - 2 强制关闭（用户开不了）
 */
@Entity('sys_user_watermark')
export class UserWatermarkEntity {
  @ApiPropertyOptional({ description: '用户 ID', example: 'e9ca23d68d884d4ebb19d07889727dae' })
  @PrimaryColumn({ type: 'varchar', length: 32, name: 'user_id', comment: '用户ID' })
  userId: string

  @ApiPropertyOptional({ description: '开关：1 开 / 0 关 / null 继承全局', nullable: true, enum: [0, 1] })
  @Column({ type: 'tinyint', nullable: true, comment: '开关(1开 0关 null继承全局)' })
  enabled?: number | null

  @ApiPropertyOptional({ description: '强管控：0 不强制 / 1 强制开 / 2 强制关', example: 0, enum: [0, 1, 2] })
  @Column({ type: 'tinyint', default: 0, comment: '强管控(0不强制 1强制开 2强制关)' })
  enforced: number

  @ApiPropertyOptional({ description: '自定义内容模板，null 继承全局', nullable: true })
  @Column({ type: 'varchar', length: 200, nullable: true, comment: '自定义内容模板' })
  content?: string | null

  @ApiPropertyOptional({ description: '自定义密度，null 继承全局', nullable: true })
  @Column({ type: 'varchar', length: 16, nullable: true, comment: '自定义密度' })
  density?: string | null

  @ApiPropertyOptional({ description: '最后修改人账号', nullable: true })
  @Column({ type: 'varchar', length: 32, name: 'updated_by', nullable: true, comment: '最后修改人' })
  updatedBy?: string | null

  @ApiPropertyOptional({ description: '最后修改时间', nullable: true })
  @Column({ type: 'datetime', name: 'updated_at', nullable: true, comment: '最后修改时间' })
  updatedAt?: Date | null
}
