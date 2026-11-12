import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, JoinTable, ManyToMany, PrimaryColumn } from 'typeorm'
import { MenuEntity } from '../../menu/entities/menu.entity'
import { UserEntity } from '../../user/entities/user.entity'

/**
 * 角色表
 * - 主键 32 位字符串，role_code 唯一（@Roles() 按 roleCode 匹配）
 * - 无 status 字段（历史表无状态列）
 * - 角色↔菜单走 sys_role_permission（role_id + permission_id）
 */
@Entity('sys_role')
export class RoleEntity {
  @ApiProperty({ description: '主键 ID（32 位字符串）', example: 'f6817f48af4fb3af11b9e8bf182f618b' })
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '主键id' })
  id: string

  @ApiPropertyOptional({ description: '角色名称（中文展示）', example: '管理员', nullable: true })
  @Column({ length: 200, nullable: true, comment: '角色名称' })
  roleName?: string

  /**
   * 角色编码：唯一性由数据库联合唯一键 `(tenant_id, role_code)` 保证
   *
   * 之前在列上写了 unique:true（全局唯一），导致租户 B 无法创建自己的 admin 编码，
   * 软删角色也会一直占着唯一键。多租户下唯一性必须带上租户维度。
   */
  @ApiProperty({ description: '角色编码（英文，用于 @Roles() 匹配；同一租户内唯一）', example: 'admin' })
  @Column({ length: 100, comment: '角色编码' })
  roleCode: string

  @ApiPropertyOptional({
    description: '数据范围：1 全部 / 2 本部门及以下 / 3 本部门 / 4 仅本人（默认 1，超级角色不受限）',
    example: 1,
    enum: [1, 2, 3, 4]
  })
  @Column({ type: 'tinyint', default: 1, comment: '数据范围(1全部 2本部门及以下 3本部门 4仅本人)' })
  dataScope?: number

  @ApiPropertyOptional({ description: '描述', example: '管理员', nullable: true })
  @Column({ length: 255, nullable: true, comment: '描述' })
  description?: string

  @ApiPropertyOptional({ description: '状态：1 正常 / 0 停用（停用后不再参与权限计算，也不能再分配给用户）', example: 1, enum: [1, 0] })
  @Column({ type: 'tinyint', default: 1, comment: '状态(1正常 0停用)' })
  status: number

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

  @ApiPropertyOptional({ description: '租户 ID（0=平台共享，>0 归属该租户）', example: 1, nullable: true })
  @Column({ type: 'int', default: 0, comment: '租户ID' })
  tenantId: number

  /**
   * 内置角色标记（admin / superadmin）
   *
   * 保护规则（不可删除 / 不可停用 / 不可授权 / 编码不可改）必须看这个标记，不能看 role_code：
   * 租户可以合法拥有自己的 admin 编码（联合唯一键允许），按编码判断会连带锁死租户的管理员角色。
   */
  @ApiProperty({ description: '是否内置角色（内置角色不可删除/停用/授权）', example: 0, enum: [0, 1] })
  @Column({ type: 'tinyint', default: 0, name: 'is_builtin', comment: '是否内置角色(1是 0否)' })
  isBuiltin: number

  @ApiProperty({ description: '已授权菜单/按钮（sys_permission）', type: [MenuEntity], required: false })
  @ManyToMany(() => MenuEntity, menu => menu.roles)
  @JoinTable({
    name: 'sys_role_permission',
    joinColumns: [{ name: 'role_id', referencedColumnName: 'id' }],
    inverseJoinColumns: [{ name: 'permission_id', referencedColumnName: 'id' }]
  })
  permissions: MenuEntity[]

  @ManyToMany(() => UserEntity, user => user.roles)
  users: UserEntity[]
}
