import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, CreateDateColumn, Entity, JoinColumn, JoinTable, ManyToMany, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import { RoleEntity } from '../../role/entities/role.entity'
import { DeptEntity } from '../../system/dept/entities/dept.entity'

/** 用户表（表结构对齐 JeecgBoot sys_user） */
@Entity('user')
export class UserEntity {
  @ApiProperty({ description: '用户 ID', example: 1 })
  @PrimaryGeneratedColumn()
  id: number

  @ApiProperty({ description: '登录账号', example: 'admin' })
  @Column({ length: 32, unique: true, comment: '登录账号' })
  username: string

  @ApiProperty({ description: '真实姓名', example: '管理员' })
  @Column({ length: 100, comment: '真实姓名' })
  realname: string

  /** select: false —— 默认查询不带出密码；任何接口响应都不返回此字段 */
  @ApiPropertyOptional({ description: '密码（加密后）', nullable: true })
  @Column({ length: 128, select: false, comment: '密码（bcrypt 加密后）' })
  password: string

  @ApiPropertyOptional({ description: '头像 URL', example: '/upload/2026-11-04/图片/xxx.png', nullable: true })
  @Column({ length: 255, nullable: true, comment: '头像' })
  avatar?: string

  @ApiPropertyOptional({ description: '性别：0 未知 / 1 男 / 2 女', example: 1, enum: [0, 1, 2], nullable: true })
  @Column({ type: 'tinyint', default: 0, comment: '性别(0-默认未知,1-男,2-女)' })
  sex: number

  @ApiPropertyOptional({ description: '手机号', example: '18611111111', nullable: true })
  @Column({ length: 45, nullable: true, comment: '手机号' })
  phone?: string

  @ApiPropertyOptional({ description: '座机号', example: '010-88886666', nullable: true })
  @Column({ length: 45, nullable: true, comment: '座机号' })
  telephone?: string

  @ApiPropertyOptional({ description: '邮箱', example: 'admin@test.com', nullable: true })
  @Column({ length: 64, nullable: true, comment: '电子邮件' })
  email?: string

  @ApiPropertyOptional({ description: '生日', example: '1990-01-01', nullable: true })
  @Column({ type: 'date', nullable: true, comment: '生日' })
  birthday?: string

  @ApiPropertyOptional({ description: '工号（唯一）', example: '00001', nullable: true })
  @Column({ name: 'work_no', length: 100, nullable: true, unique: true, comment: '工号，唯一' })
  workNo?: string

  @ApiProperty({ description: '状态：0 禁用 / 1 启用（对应 sys_user.status 1-正常 2-冻结）', example: 1, enum: [0, 1] })
  @Column({ type: 'tinyint', default: 1, comment: '状态：0禁用 1启用' })
  status: number

  @ApiProperty({ description: '删除状态：0 正常 / 1 已删除（软删除）', example: 0, enum: [0, 1] })
  @Column({ name: 'del_flag', type: 'tinyint', default: 0, comment: '删除状态(0-正常,1-已删除)' })
  delFlag: number

  @ApiPropertyOptional({ description: '创建人', example: 'admin', nullable: true })
  @Column({ name: 'create_by', length: 32, nullable: true, comment: '创建人' })
  createBy?: string

  @ApiPropertyOptional({ description: '更新人', example: 'admin', nullable: true })
  @Column({ name: 'update_by', length: 32, nullable: true, comment: '更新人' })
  updateBy?: string

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

  @ApiPropertyOptional({ description: '所属部门 ID，0/空 为未分配', example: 1, nullable: true })
  @Column({ type: 'int', default: 0, comment: '所属部门ID，0为未分配' })
  deptId: number

  @ApiPropertyOptional({ description: '所属部门', type: DeptEntity, required: false })
  @ManyToOne(() => DeptEntity, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'deptId' })
  dept?: DeptEntity | null
}
