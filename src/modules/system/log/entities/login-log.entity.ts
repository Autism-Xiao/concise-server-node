import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity('login_log')
export class LoginLogEntity {
  @ApiProperty({ description: '日志 ID', example: 1 })
  @PrimaryGeneratedColumn()
  id: number

  @ApiProperty({ description: '登录用户名（尝试的账号）', example: 'admin' })
  @Column({ length: 32, comment: '登录用户名' })
  username: string

  @ApiProperty({ description: '结果：0 失败 / 1 成功', example: 1, enum: [0, 1] })
  @Column({ type: 'tinyint', comment: '结果：0失败 1成功' })
  status: number

  @ApiProperty({ description: '结果说明', example: '登录成功' })
  @Column({ length: 128, comment: '结果说明' })
  message: string

  @ApiProperty({ description: '登录 IP', example: '127.0.0.1' })
  @Column({ length: 64, comment: '登录IP' })
  ip: string

  @ApiPropertyOptional({ description: 'User-Agent', nullable: true })
  @Column({ length: 255, nullable: true, comment: 'User-Agent' })
  userAgent?: string

  @ApiProperty({ description: '登录时间' })
  @CreateDateColumn({ name: 'created_at', comment: '登录时间' })
  createdAt: Date
}
