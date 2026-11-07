import { ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, PrimaryColumn } from 'typeorm'

/**
 * 用户界面偏好设置（字号 / 主题色 / 布局 / 方向 …）
 *
 * 为什么按用户存而不是全局一份：这些都是**个人**偏好，
 * 一个人把主题改成樱桃红不应该影响同事。全局默认值仍由前端 `DEFAULT_SETTINGS` 提供。
 *
 * 为什么用 TEXT 存 JSON 而不是拆列：设置项会随前端迭代增减，
 * 拆列意味着每加一个开关就要改表结构 + 发版；整包存 + 服务端白名单过滤更灵活。
 */
@Entity('sys_user_setting')
export class UserSettingEntity {
  @ApiPropertyOptional({ description: '用户 ID', example: 'e9ca23d68d884d4ebb19d07889727dae' })
  @PrimaryColumn({ type: 'varchar', length: 32, name: 'user_id', comment: '用户ID' })
  userId: string

  @ApiPropertyOptional({ description: '设置 JSON（服务端已按白名单裁剪）' })
  @Column({ type: 'text', comment: '设置JSON(白名单裁剪后)' })
  settings: string

  @ApiPropertyOptional({ description: '最后修改时间', nullable: true })
  @Column({ type: 'datetime', name: 'update_time', nullable: true, comment: '最后修改时间' })
  updateTime?: Date | null
}
