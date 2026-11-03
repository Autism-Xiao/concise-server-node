import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, CreateDateColumn, Entity, JoinTable, ManyToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import { RoleEntity } from '../../role/entities/role.entity'

@Entity('user')
export class UserEntity {
  @ApiProperty({ description: '用户 ID', example: 1 })
  @PrimaryGeneratedColumn()
  id: number

  @ApiProperty({ description: '用户名', example: 'admin' })
  @Column({ length: 32, unique: true, comment: '用户名' })
  username: string

  @ApiProperty({ description: '昵称', example: '管理员' })
  @Column({ length: 32, comment: '昵称' })
  nickname: string

  /** select: false —— 默认查询不带出密码；任何接口响应都不返回此字段 */
  @Column({ length: 128, select: false, comment: '密码（加密后）' })
  password: string

  @ApiPropertyOptional({ description: '邮箱', example: 'admin@test.com', nullable: true })
  @Column({ length: 64, nullable: true, comment: '邮箱' })
  email?: string

  @ApiProperty({ description: '状态：0 禁用 / 1 启用', example: 1, enum: [0, 1] })
  @Column({ type: 'tinyint', default: 1, comment: '状态：0禁用 1启用' })
  status: number

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
  createdAt: Date

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at', comment: '更新时间' })
  updatedAt: Date

  @ApiProperty({ description: '角色列表', type: [RoleEntity], required: false })
  @ManyToMany(() => RoleEntity, role => role.users)
  @JoinTable({ name: 'user_roles' })
  roles: RoleEntity[]
}
