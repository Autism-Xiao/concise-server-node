import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, JoinTable, ManyToMany, PrimaryColumn } from 'typeorm'
import { RoleEntity } from '../../role/entities/role.entity'
import { DeptEntity } from '../../system/dept/entities/dept.entity'

/**
 * 用户表（对齐 JeecgBoot sys_user）
 * - 主键为 32 位字符串（非自增），由 randomId32() 生成
 * - 密码为 JeecgBoot 兼容的 PBEWithMD5AndDES(username, password, salt)，16 位 hex
 * - 全局 SnakeNamingStrategy 下驼峰属性自动映射下划线列名
 * - 部门：多对多走 sys_user_depart（对齐 JeecgBoot，一个用户可挂多个部门）；
 *   主部门 = depart_ids 的第一个 id，其机构编码冗余到 org_code 供数据权限过滤
 */
@Entity('sys_user')
export class UserEntity {
  @ApiProperty({ description: '主键ID（32位字符串）', example: 'e9ca23d68d884d4ebb19d07889727dae' })
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '主键id' })
  id: string

  @ApiProperty({ description: '登录账号', example: 'admin' })
  @Column({ length: 100, unique: true, comment: '登录账号' })
  username: string

  @ApiProperty({ description: '真实姓名', example: '管理员' })
  @Column({ length: 100, nullable: true, comment: '真实姓名', charset: 'utf8mb4' })
  realname?: string

  /** select: false —— 默认查询不带出密码与盐；任何接口响应都不返回 */
  @ApiPropertyOptional({ description: '密码（PBEWithMD5AndDES 16位hex）', nullable: true })
  @Column({ length: 255, select: false, comment: '密码' })
  password?: string

  @ApiPropertyOptional({ description: '密码盐', nullable: true })
  @Column({ length: 45, select: false, comment: 'md5密码盐' })
  salt?: string

  @ApiPropertyOptional({ description: '头像 URL', nullable: true })
  @Column({ length: 255, nullable: true, comment: '头像' })
  avatar?: string

  @ApiPropertyOptional({ description: '生日', example: '1990-01-01', nullable: true })
  @Column({ type: 'date', nullable: true, comment: '生日' })
  birthday?: string

  @ApiPropertyOptional({ description: '性别：0 未知 / 1 男 / 2 女', example: 1, enum: [0, 1, 2], nullable: true })
  @Column({ type: 'tinyint', nullable: true, comment: '性别(0-默认未知,1-男,2-女)' })
  sex?: number

  @ApiPropertyOptional({ description: '电子邮件', nullable: true })
  @Column({ length: 45, nullable: true, comment: '电子邮件' })
  email?: string

  @ApiPropertyOptional({ description: '电话', nullable: true })
  @Column({ length: 45, nullable: true, comment: '电话' })
  phone?: string

  @ApiProperty({ description: '状态：1 正常 / 2 冻结（对齐 sys_user）', example: 1, enum: [1, 2] })
  @Column({ type: 'tinyint', nullable: true, comment: '状态(1-正常,2-冻结)' })
  status: number

  @ApiProperty({ description: '删除状态：0 正常 / 1 已删除（软删除）', example: 0, enum: [0, 1] })
  @Column({ type: 'tinyint', nullable: true, comment: '删除状态(0-正常,1-已删除)' })
  delFlag: number

  @ApiPropertyOptional({ description: '工号（唯一）', example: '00001', nullable: true })
  @Column({ length: 100, nullable: true, unique: true, comment: '工号，唯一键' })
  workNo?: string

  @ApiPropertyOptional({ description: '座机号', nullable: true })
  @Column({ length: 45, nullable: true, comment: '座机号' })
  telephone?: string

  @ApiPropertyOptional({ description: '创建人', nullable: true })
  @Column({ length: 32, nullable: true, comment: '创建人' })
  createBy?: string

  @ApiProperty({ description: '创建时间' })
  @Column({ type: 'datetime', nullable: true, comment: '创建时间' })
  createTime?: Date

  @ApiPropertyOptional({ description: '更新人', nullable: true })
  @Column({ length: 32, nullable: true, comment: '更新人' })
  updateBy?: string

  @ApiProperty({ description: '更新时间' })
  @Column({ type: 'datetime', nullable: true, comment: '更新时间' })
  updateTime?: Date

  @ApiProperty({ description: '角色列表', type: [RoleEntity], required: false })
  @ManyToMany(() => RoleEntity, role => role.users)
  @JoinTable({
    name: 'sys_user_role',
    joinColumns: [{ name: 'user_id', referencedColumnName: 'id' }],
    inverseJoinColumns: [{ name: 'role_id', referencedColumnName: 'id' }]
  })
  roles: RoleEntity[]

  @ApiPropertyOptional({ description: '所属机构编码（主部门 org_code 冗余，用于数据权限过滤）', example: 'A01', nullable: true })
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '登录会话的机构编码' })
  orgCode?: string | null

  @ApiPropertyOptional({
    description: '所属部门 ID 集合（逗号分隔，顺序即主次，首个为主部门）',
    example: 'dept_1,dept_2',
    nullable: true
  })
  @Column({ type: 'varchar', length: 1000, nullable: true, comment: '所属部门id集合' })
  departIds?: string | null

  @ApiProperty({ description: '所属部门列表（sys_user_depart 多对多）', type: [DeptEntity], required: false })
  @ManyToMany(() => DeptEntity, dept => dept.users)
  @JoinTable({
    name: 'sys_user_depart',
    joinColumns: [{ name: 'user_id', referencedColumnName: 'id' }],
    inverseJoinColumns: [{ name: 'dep_id', referencedColumnName: 'id' }]
  })
  depts?: DeptEntity[]

  /**
   * 主部门（= depts[0]），非数据库列，由 UserService 组装
   * 保留该字段是为了兼容旧前端/旧接口里单个 dept 的返回结构
   */
  @ApiPropertyOptional({ description: '主部门（部门列表第一个元素，兼容字段）', type: DeptEntity, required: false })
  dept?: DeptEntity | null
}
