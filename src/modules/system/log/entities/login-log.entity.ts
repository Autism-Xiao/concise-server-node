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

  @ApiPropertyOptional({ description: '浏览器（UA 解析，如 Chrome 156）', example: 'Chrome 156', nullable: true })
  @Column({ length: 64, nullable: true, comment: '浏览器（UA解析）' })
  browser?: string

  @ApiPropertyOptional({ description: '操作系统（UA 解析，如 Windows 10）', example: 'Windows 10', nullable: true })
  @Column({ length: 64, nullable: true, comment: '操作系统（UA解析）' })
  os?: string

  @ApiPropertyOptional({ description: 'IP 归属地（本机/内网IP/省市 运营商）', example: '本机', nullable: true })
  @Column({ length: 128, nullable: true, comment: 'IP归属地（ip2region）' })
  location?: string

  @ApiProperty({ description: '登录时间' })
  @CreateDateColumn({ name: 'created_at', comment: '登录时间' })
  createdAt: Date
}
