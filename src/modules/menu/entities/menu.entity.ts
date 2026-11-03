import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, JoinTable, ManyToMany, ManyToOne, OneToMany, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm'
import { RoleEntity } from '../../role/entities/role.entity'

@Entity('menu')
export class MenuEntity {
  @ApiProperty({ description: '菜单 ID', example: 1 })
  @PrimaryGeneratedColumn()
  id: number

  @ApiProperty({ description: '菜单名称', example: '用户管理' })
  @Column({ length: 32, comment: '菜单名称' })
  name: string

  @ApiProperty({ description: '类型：0 目录 / 1 菜单 / 2 按钮', example: 1, enum: [0, 1, 2] })
  @Column({ type: 'tinyint', default: 1, comment: '类型：0目录 1菜单 2按钮' })
  type: number

  @ApiPropertyOptional({ description: '路由路径', example: '/system/user', nullable: true })
  @Column({ length: 128, nullable: true, comment: '路由路径' })
  path?: string

  @ApiPropertyOptional({ description: '前端组件路径', example: 'system/user/index', nullable: true })
  @Column({ length: 128, nullable: true, comment: '前端组件路径' })
  component?: string

  @ApiPropertyOptional({ description: '图标', example: 'user', nullable: true })
  @Column({ length: 64, nullable: true, comment: '图标' })
  icon?: string

  @ApiPropertyOptional({ description: '权限标识（按钮级，如 system:user:add）', example: 'system:user:list', nullable: true })
  @Column({ length: 64, nullable: true, comment: '权限标识' })
  permission?: string

  @ApiProperty({ description: '父级菜单 ID，0 为顶级', example: 0 })
  @Column({ type: 'int', default: 0, comment: '父级ID，0为顶级' })
  parentId: number

  @ApiProperty({ description: '排序号，越小越靠前', example: 0 })
  @Column({ type: 'int', default: 0, comment: '排序号' })
  sort: number

  @ApiProperty({ description: '状态：0 禁用 / 1 启用', example: 1, enum: [0, 1] })
  @Column({ type: 'tinyint', default: 1, comment: '状态：0禁用 1启用' })
  status: number

  @ManyToOne(() => MenuEntity, menu => menu.children, { createForeignKeyConstraints: false })
  parent?: MenuEntity

  @OneToMany(() => MenuEntity, menu => menu.parent)
  children: MenuEntity[]

  @ManyToMany(() => RoleEntity, role => role.menus)
  @JoinTable({ name: 'role_menus' })
  roles: RoleEntity[]

  @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', comment: '更新时间' })
  updatedAt: Date
}
