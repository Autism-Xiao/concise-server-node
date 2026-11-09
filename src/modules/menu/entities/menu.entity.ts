import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, ManyToMany, PrimaryColumn } from 'typeorm'
import { RoleEntity } from '../../role/entities/role.entity'

/**
 * 菜单权限表（对齐 JeecgBoot sys_permission）
 * - 主键 32 位字符串；parent_id 为 null/'' 表示顶级
 * - menu_type：0 一级菜单 / 1 子菜单 / 2 按钮权限
 * - perms 为按钮权限编码（如 system:user:add），供 PermsGuard 校验
 * - status 为 varchar：'1' 有效 / '0' 无效（JeecgBoot 原样）
 */
@Entity('sys_permission')
export class MenuEntity {
  @ApiProperty({ description: '主键 ID（32 位字符串）', example: 'menu_1' })
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '主键id' })
  id: string

  @ApiPropertyOptional({ description: '父级 ID，null 为顶级', example: 'menu_1', nullable: true })
  @Column({ type: 'varchar', length: 32, nullable: true, comment: '父id' })
  parentId?: string | null

  @ApiProperty({ description: '菜单标题', example: '用户管理' })
  @Column({ length: 255, nullable: true, comment: '菜单标题' })
  name: string

  @ApiPropertyOptional({ description: '路由路径', example: '/system/user', nullable: true })
  @Column({ length: 255, nullable: true, comment: '路径' })
  url?: string

  @ApiPropertyOptional({ description: '前端组件路径', example: 'system/user/index', nullable: true })
  @Column({ length: 255, nullable: true, comment: '组件' })
  component?: string

  @ApiPropertyOptional({ description: '是否路由菜单：0 否 / 1 是', example: 1, nullable: true })
  @Column({ type: 'tinyint', default: 1, comment: '是否路由菜单: 0:不是  1:是（默认值1）' })
  isRoute?: number

  @ApiPropertyOptional({ description: '组件名字', example: 'system-user', nullable: true })
  @Column({ length: 255, nullable: true, comment: '组件名字' })
  componentName?: string

  @ApiPropertyOptional({ description: '一级菜单跳转地址', example: '/system/user', nullable: true })
  @Column({ length: 255, nullable: true, comment: '一级菜单跳转地址' })
  redirect?: string

  @ApiProperty({ description: '菜单类型：0 一级菜单 / 1 子菜单 / 2 按钮权限', example: 1, enum: [0, 1, 2] })
  @Column({ type: 'int', nullable: true, comment: '菜单类型(0:一级菜单; 1:子菜单:2:按钮权限)' })
  menuType: number

  @ApiPropertyOptional({ description: '菜单权限编码（按钮级）', example: 'system:user:add', nullable: true })
  @Column({ length: 255, nullable: true, comment: '菜单权限编码' })
  perms?: string

  /**
   * 作用域：platform 平台级 / tenant 租户级
   *
   * platform 的含义是「光有权限码不够，还必须是平台管理员」：租户管理、菜单管理、运维监控、
   * 存储配置这几类改的是全平台唯一的东西，不能让租户管理员自己授权给自己。
   * 同时这类菜单不会出现在租户用户的导航树里（见 AuthService.getPermissions）。
   */
  @ApiPropertyOptional({ description: '作用域：platform 平台级 / tenant 租户级', example: 'tenant', enum: ['platform', 'tenant'] })
  @Column({ type: 'varchar', length: 16, default: 'tenant', comment: '作用域(platform平台级 tenant租户级)' })
  scope?: string

  @ApiPropertyOptional({ description: '权限策略：1 显示 / 2 禁用', example: '1', nullable: true })
  @Column({ length: 10, default: '0', comment: '权限策略1显示2禁用' })
  permsType?: string

  @ApiPropertyOptional({ description: '菜单排序', example: 1, nullable: true })
  @Column({ type: 'double', nullable: true, comment: '菜单排序' })
  sortNo?: number

  @ApiPropertyOptional({ description: '聚合子路由：1 是 / 0 否', example: 0, nullable: true })
  @Column({ type: 'tinyint', nullable: true, comment: '聚合子路由: 1是0否' })
  alwaysShow?: number

  @ApiPropertyOptional({ description: '菜单图标', example: 'user', nullable: true })
  @Column({ length: 255, nullable: true, comment: '菜单图标' })
  icon?: string

  @ApiPropertyOptional({ description: '是否叶子节点：1 是 / 0 否', example: 1, nullable: true })
  @Column({ type: 'tinyint', nullable: true, comment: '是否叶子节点:    1是0否' })
  isLeaf?: number

  @ApiPropertyOptional({ description: '是否缓存该页面：1 是 / 0 否', example: 0, nullable: true })
  @Column({ type: 'tinyint', nullable: true, comment: '是否缓存该页面:    1:是   0:不是' })
  keepAlive?: number

  @ApiPropertyOptional({ description: '是否隐藏路由：0 否 / 1 是', example: 0, nullable: true })
  @Column({ type: 'tinyint', default: 0, comment: '是否隐藏路由: 0否,1是' })
  hidden?: number

  @ApiPropertyOptional({ description: '是否隐藏 tab：0 否 / 1 是', example: 0, nullable: true })
  @Column({ type: 'tinyint', nullable: true, comment: '是否隐藏tab: 0否,1是' })
  hideTab?: number

  @ApiPropertyOptional({ description: '描述', nullable: true })
  @Column({ length: 255, nullable: true, comment: '描述' })
  description?: string

  @ApiPropertyOptional({ description: '创建人', nullable: true })
  @Column({ length: 255, nullable: true, comment: '创建人' })
  createBy?: string

  @ApiPropertyOptional({ description: '创建时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '创建时间' })
  createTime?: Date

  @ApiPropertyOptional({ description: '更新人', nullable: true })
  @Column({ length: 255, nullable: true, comment: '更新人' })
  updateBy?: string

  @ApiPropertyOptional({ description: '更新时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '更新时间' })
  updateTime?: Date

  @ApiPropertyOptional({ description: '删除状态：0 正常 / 1 已删除', example: 0, nullable: true })
  @Column({ type: 'int', default: 0, comment: '删除状态 0正常 1已删除' })
  delFlag?: number

  @ApiPropertyOptional({ description: '是否添加数据权限：1 是 / 0 否', example: 0, nullable: true })
  @Column({ type: 'int', default: 0, comment: '是否添加数据权限1是0否' })
  ruleFlag?: number

  @ApiPropertyOptional({ description: '按钮权限状态：0 无效 / 1 有效', example: '1', nullable: true })
  @Column({ length: 2, nullable: true, comment: '按钮权限状态(0无效1有效)' })
  status?: string

  @ApiPropertyOptional({ description: '外链打开方式：0 内部 / 1 外部', example: 0, nullable: true })
  @Column({ type: 'tinyint', nullable: true, comment: '外链菜单打开方式 0/内部打开 1/外部打开' })
  internalOrExternal?: number

  @ManyToMany(() => RoleEntity, role => role.permissions)
  roles: RoleEntity[]
}
