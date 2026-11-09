import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, PrimaryColumn } from 'typeorm'

/** 水印模式：用户可自选 / 全站强制 / 全站关闭 */
export type WatermarkMode = 'optional' | 'forced' | 'off'

/**
 * 页面水印策略（按租户一行）
 *
 * 这是「默认开关在 admin」的落点：默认开关、默认文案、样式参数只在这里改，
 * 用户自身没有样式控制权（否则把不透明度调成 0 就等于关掉了水印）。
 *
 * 多租户：主键是 `tenant_id`
 * - `0` 平台默认（兜底，所有租户继承）
 * - `>0` 该租户自己的策略
 * 之前是单行表（id 恒为 1），任何租户管理员改水印都等于改全平台，属于跨租户越权。
 */
@Entity('sys_watermark_setting')
export class WatermarkSettingEntity {
  @ApiProperty({ description: '租户 ID：0 = 平台默认，>0 = 该租户策略', example: 1 })
  @PrimaryColumn({ type: 'int', name: 'tenant_id', comment: '租户ID(0=平台默认)' })
  tenantId: number

  @ApiProperty({ description: '全局默认开关：1 开 / 0 关，未自定义的用户继承此值', example: 1, enum: [0, 1] })
  @Column({ type: 'tinyint', default: 1, comment: '全局默认开关(1开 0关)' })
  enabled: number

  @ApiProperty({
    description: '策略：optional 用户可自选 / forced 全站强制开 / off 全站关闭',
    example: 'optional',
    enum: ['optional', 'forced', 'off']
  })
  @Column({ type: 'varchar', length: 16, default: 'optional', comment: '策略(optional/forced/off)' })
  mode: string

  @ApiProperty({ description: '默认水印内容模板，支持占位符与换行', example: '{username}\n{date} {time}' })
  @Column({ type: 'varchar', length: 200, default: '{username}', comment: '默认内容模板' })
  content: string

  @ApiProperty({ description: '默认密度：compact 紧凑 / default 标准 / loose 宽松', example: 'default', enum: ['compact', 'default', 'loose'] })
  @Column({ type: 'varchar', length: 16, default: 'default', comment: '默认密度' })
  density: string

  @ApiProperty({ description: '不透明度百分比（4~30）', example: 8 })
  @Column({ type: 'tinyint', default: 8, comment: '不透明度百分比' })
  opacity: number

  @ApiProperty({ description: '倾斜角度（-60~0）', example: -22 })
  @Column({ type: 'smallint', default: -22, comment: '倾斜角度' })
  rotate: number

  @ApiProperty({ description: '字号 px（10~24）', example: 14 })
  @Column({ type: 'tinyint', name: 'font_size', default: 14, comment: '字号px' })
  fontSize: number

  @ApiPropertyOptional({ description: '最后修改人账号', nullable: true })
  @Column({ type: 'varchar', length: 32, name: 'updated_by', nullable: true, comment: '最后修改人' })
  updatedBy?: string | null

  @ApiPropertyOptional({ description: '最后修改时间', nullable: true })
  @Column({ type: 'datetime', name: 'updated_at', nullable: true, comment: '最后修改时间' })
  updatedAt?: Date | null
}
