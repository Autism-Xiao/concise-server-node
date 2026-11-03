import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity('oper_log')
export class OperLogEntity {
  @ApiProperty({ description: '日志 ID', example: 1 })
  @PrimaryGeneratedColumn()
  id: number

  @ApiPropertyOptional({ description: '操作人用户 ID（未登录为空）', example: 1, nullable: true })
  @Column({ type: 'int', nullable: true, comment: '操作人用户ID' })
  userId?: number

  @ApiPropertyOptional({ description: '操作人用户名', example: 'admin', nullable: true })
  @Column({ length: 32, nullable: true, comment: '操作人用户名' })
  username?: string

  @ApiProperty({ description: '操作模块', example: '用户管理' })
  @Column({ length: 64, comment: '操作模块' })
  module: string

  @ApiProperty({ description: '操作动作', example: 'POST /api/users' })
  @Column({ length: 128, comment: '操作动作（方法+路径）' })
  action: string

  @ApiProperty({ description: '请求 IP', example: '127.0.0.1' })
  @Column({ length: 64, comment: '请求IP' })
  ip: string

  @ApiPropertyOptional({ description: '请求参数（JSON）', nullable: true })
  @Column({ type: 'text', nullable: true, comment: '请求参数（body+query JSON）' })
  params?: string

  @ApiProperty({ description: '结果：0 失败 / 1 成功', example: 1, enum: [0, 1] })
  @Column({ type: 'tinyint', comment: '结果：0失败 1成功' })
  status: number

  @ApiPropertyOptional({ description: '错误信息（失败时）', nullable: true })
  @Column({ length: 255, nullable: true, comment: '错误信息' })
  errorMsg?: string

  @ApiProperty({ description: '耗时（毫秒）', example: 35 })
  @Column({ type: 'int', comment: '耗时（毫秒）' })
  elapsed: number

  @ApiProperty({ description: '操作时间' })
  @CreateDateColumn({ name: 'created_at', comment: '操作时间' })
  createdAt: Date
}
