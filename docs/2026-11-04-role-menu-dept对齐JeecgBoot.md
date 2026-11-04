# role / menu / dept 三表对齐 JeecgBoot（sys_role、sys_permission、sys_depart）

> 日期：2026-11-04
> 提交：本轮
> 前置：上一轮 `user` 表已替换为 JeecgBoot `sys_user`，并开启全局 snake_case 命名策略

---

## 一、这次做了什么

把剩余三张核心表按 JeecgBoot 结构重建，**主键统一为 varchar(32) 字符串**，关联表改名，数据按规则迁移，代码全链路适配：

| 旧表 | 新表 | 说明 |
| --- | --- | --- |
| `role` | `sys_role` | 角色标识 `name` → `role_code`，名称 `label` → `role_name`，去掉 `status`，加 `tenant_id` |
| `menu` | `sys_permission` | `type` → `menu_type`、`permission` → `perms`、`sort` → `sort_no`、`path` → `url`，`parent_id` 顶级用 `NULL` |
| `dept` | `sys_depart` | `name` → `depart_name`、`sort` → `depart_order`、`phone` → `mobile`，新增必填唯一 `org_code`（机构编码） |
| `user_roles` | `sys_user_role` | JeecgBoot 结构：独立 `id` + `tenant_id` |
| `role_menus` | `sys_role_permission` | 字段名 `menu_id` → `permission_id` |

---

## 二、改了哪些文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/modules/role/entities/role.entity.ts` | 重写 | `sys_role` 实体，字符串主键，`roleCode` 唯一 |
| `src/modules/role/dto/create-role.dto.ts` | 重写 | `roleName` / `roleCode` / `description` / `menuIds: string[]` |
| `src/modules/role/role.service.ts` | 重写 | 字符串 id；`assignMenus` 改为**多退少补**的真正全量覆盖 |
| `src/modules/role/role.controller.ts` | 重写 | 去掉 `ParseIntPipe`（id 已是字符串），关联名 `menus` → `permissions` |
| `src/modules/menu/entities/menu.entity.ts` | 重写 | `sys_permission` 实体，26 列全量对齐 |
| `src/modules/menu/dto/create-menu.dto.ts` | 重写 | `menuType` / `perms` / `sortNo` / `isRoute` / `status: '0'\|'1'` |
| `src/modules/menu/menu.service.ts` | 重写 | 树按 `parent_id = NULL` 定根；创建补默认值 |
| `src/modules/menu/menu.controller.ts` | 重写 | 字符串 id |
| `src/modules/system/dept/entities/dept.entity.ts` | 重写 | `sys_depart` 实体，`orgCode` 唯一必填 |
| `src/modules/system/dept/dto/create-dept.dto.ts` | 重写 | `departName` / `parentId` / `departOrder` / `orgCode?` / `mobile` / `status` |
| `src/modules/system/dept/dept.service.ts` | 重写 | 字符串 id、`orgCode` 自动生成、软删、防环 |
| `src/modules/system/dept/dept.controller.ts` | 重写 | 字符串 id |
| `src/modules/user/entities/user.entity.ts` | 修改 | 关联表改 `sys_user_role`；`deptId` 改 `varchar(32)` |
| `src/modules/user/dto/create-user.dto.ts` | 修改 | `roleIds: string[]`、`deptId: string` |
| `src/modules/user/dto/query-user.dto.ts` | 修改 | `deptId` 过滤改字符串 |
| `src/modules/user/user.service.ts` | 修改 | `assignRoles` 多退少补 |
| `src/modules/user/user.controller.ts` | 修改 | `/users/:id/roles` 的 `roleIds` 类型 |
| `src/common/guards/roles.guard.ts` | 修改 | 按 `roleCode` 匹配 `@Roles()` |
| `src/common/guards/perms.guard.ts` | 修改 | 改查 `sys_permission.perms` + `sys_role_permission` |
| `src/helper/crud/base.service.ts` | 修改 | 创建时对**字符串主键实体**自动生成 32 位 id |
| `src/migrations/1793766529976-Migration.ts` | 新增 | 三表替换 + 数据迁移 + 关联表重建 |
| `src/migrations/1793767136137-Migration.ts` | 新增 | 关联表去重 + 唯一索引 |

---

## 三、完整代码

### 1. `src/modules/role/entities/role.entity.ts`

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, JoinTable, ManyToMany, PrimaryColumn } from 'typeorm'
import { MenuEntity } from '../../menu/entities/menu.entity'
import { UserEntity } from '../../user/entities/user.entity'

/**
 * 角色表（对齐 JeecgBoot sys_role）
 * - 主键 32 位字符串，role_code 唯一（@Roles() 按 roleCode 匹配）
 * - 无 status 字段（JeecgBoot 原表无状态列）
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

  @ApiProperty({ description: '角色编码（英文，用于 @Roles() 匹配）', example: 'admin' })
  @Column({ length: 100, unique: true, comment: '角色编码' })
  roleCode: string

  @ApiPropertyOptional({ description: '描述', example: '管理员', nullable: true })
  @Column({ length: 255, nullable: true, comment: '描述' })
  description?: string

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

  @ApiPropertyOptional({ description: '租户 ID（对齐 JeecgBoot，默认 0）', example: 0, nullable: true })
  @Column({ type: 'int', default: 0, comment: '租户ID' })
  tenantId: number

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
```

**学习点**

- `@JoinTable` 显式写 `role_id` / `permission_id`：JeecgBoot 关联表列名不是 TypeORM 默认的 `roleId` / `menuId`，不写死会报列不存在。
- 属性名 `roleName`、`roleCode` 由全局 `SnakeNamingStrategy` 自动映射为 `role_name`、`role_code`，不需要手写 `name`。

### 2. `src/modules/role/role.service.ts`

```ts
import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'

import { BaseService } from '../../helper/crud/base.service'
import { RoleEntity } from './entities/role.entity'
import { MenuEntity } from '../menu/entities/menu.entity'
import type { CreateRoleDto } from './dto/create-role.dto'

@Injectable()
export class RoleService extends BaseService<RoleEntity> {
  constructor(
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>
  ) {
    super(roleRepository, '角色')
  }

  /** 创建角色，支持 menuIds 绑定菜单权限（id 由 BaseService 自动生成 32 位） */
  async createRole(dto: CreateRoleDto): Promise<RoleEntity> {
    const role = await this.create({
      roleName: dto.roleName,
      roleCode: dto.roleCode,
      description: dto.description
    })
    if (dto.menuIds?.length) {
      await this.assignMenus(role.id, dto.menuIds)
    }
    return this.findOneWithMenus(role.id)
  }

  /** 绑定菜单权限（全量覆盖：多退少补） */
  async assignMenus(id: string, menuIds: string[]): Promise<void> {
    await this.findOne(id)
    const menus = await this.roleRepository.manager.getRepository(MenuEntity).find({ where: { id: In(menuIds) } })
    if (menus.length !== menuIds.length) {
      throw new NotFoundException('存在无效的菜单 ID')
    }
    const nextIds = new Set(menuIds)
    const current = await this.roleRepository.createQueryBuilder().relation(RoleEntity, 'permissions').of(id).loadMany<MenuEntity>()
    const currentIds = new Set(current.map(menu => menu.id))
    // 只新增差集、删除差集，避免重复插入关联行
    const toAdd = menus.filter(menu => !currentIds.has(menu.id))
    const toRemove = current.filter(menu => !nextIds.has(menu.id))
    await this.roleRepository.createQueryBuilder().relation(RoleEntity, 'permissions').of(id).addAndRemove(toAdd, toRemove)
  }

  /** 查角色详情（含菜单权限） */
  async findOneWithMenus(id: string): Promise<RoleEntity> {
    const role = await this.roleRepository.findOne({ where: { id }, relations: { permissions: true } })
    if (!role) {
      throw new NotFoundException('角色不存在')
    }
    return role
  }

  /** 按 id 列表查角色 */
  async findByIds(ids: string[]): Promise<RoleEntity[]> {
    return this.roleRepository.findBy({ id: In(ids) })
  }
}
```

**学习点（重点）**

- `addAndRemove(entitiesToAdd, entitiesToRemove)` **不是**「用第一个参数替换全部」：它只做加/减，第二个参数为空就等于「只加不减」。旧代码写 `addAndRemove(menus, [])` 会导致「收回权限」完全无效。
- 它还会对已存在的关联**重复插入**（关联表没有唯一约束时），所以必须自己算差集 `toAdd` / `toRemove`。
- 兜底手段是给关联表加 `UNIQUE (role_id, permission_id)`，见迁移 2。

### 3. `src/modules/menu/entities/menu.entity.ts`

```ts
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
```

**学习点**

- `parentId?: string | null` 这种**联合类型**必须显式写 `type: 'varchar'`：TS 的 `design:type` 元数据会退化成 `Object`，TypeORM 启动时报 `Data type "Object" ... is not supported`。
- `status` 从 `tinyint` 变 `varchar(2)`，值域 `'1'/'0'`，判断时不能再用 `status = 1`。

### 4. `src/modules/menu/menu.service.ts`

```ts
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull, Repository, type DeepPartial } from 'typeorm'

import { BaseService } from '../../helper/crud/base.service'
import { MenuEntity } from './entities/menu.entity'

export interface MenuTreeItem extends MenuEntity {
  children: MenuTreeItem[]
}

/** 顶级菜单的 parent_id 约定（JeecgBoot 用 null 或空串） */
function isRootParent(parentId?: string | null): boolean {
  return parentId === null || parentId === undefined || parentId === ''
}

@Injectable()
export class MenuService extends BaseService<MenuEntity> {
  constructor(
    @InjectRepository(MenuEntity)
    repository: Repository<MenuEntity>
  ) {
    super(repository, '菜单')
  }

  /** 创建：补 JeecgBoot 默认值（未删除、有效、是路由、不隐藏） */
  async create(dto: DeepPartial<MenuEntity>): Promise<MenuEntity> {
    return super.create({
      ...dto,
      delFlag: dto.delFlag ?? 0,
      status: dto.status ?? '1',
      isRoute: dto.isRoute ?? 1,
      hidden: dto.hidden ?? 0,
      permsType: dto.permsType ?? '1',
      sortNo: dto.sortNo ?? 0,
      createTime: new Date()
    })
  }

  /** 全量菜单（按 sort_no 升序，排除已删除） */
  async listAll(): Promise<MenuEntity[]> {
    return this.repository.find({ where: { delFlag: 0 }, order: { sortNo: 'ASC', id: 'ASC' } })
  }

  /** 扁平列表转树（parent_id 为 null/'' 视为顶级） */
  async getTree(): Promise<MenuTreeItem[]> {
    const all = await this.listAll()
    return buildMenuTree(all, null)
  }

  /** 顶级菜单（供外部按父查询） */
  async listRoots(): Promise<MenuEntity[]> {
    return this.repository.find({ where: { parentId: IsNull(), delFlag: 0 }, order: { sortNo: 'ASC' } })
  }
}

/** list-to-tree：不递归查库，一次取全量后内存组装 */
export function buildMenuTree(all: MenuEntity[], parentId: string | null): MenuTreeItem[] {
  return all
    .filter(menu => (parentId === null ? isRootParent(menu.parentId) : menu.parentId === parentId))
    .map(menu =>
      // 实体实例展开为 plain object 组树（响应走 JSON 序列化，无原型丢失问题）
      // oxlint-disable-next-line typescript(no-misused-spread)
      ({
        ...menu,
        children: buildMenuTree(all, menu.id)
      })
    )
}
```

**学习点（踩过的坑）**

- 默认值必须写成 `dto.status ?? '1'` 并且放在展开之后。最初的写法是先给默认值再 `...dto`，而 DTO 实例上 `status` 是 `undefined` 的自有属性，直接把默认值覆盖成 `undefined`，落库变成 `NULL`，按钮权限随即失效。
- 顶级判定从 `parentId === 0` 改为 `null / undefined / ''` 三态兼容。

### 5. `src/modules/system/dept/entities/dept.entity.ts`

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, PrimaryColumn } from 'typeorm'

/**
 * 组织机构表（对齐 JeecgBoot sys_depart）
 * - 主键 32 位字符串；parent_id 为 null/'' 视为顶级
 * - org_code 唯一且必填（JeecgBoot 用它做机构编码，也用于用户 sys_user.org_code）
 * - status / del_flag 为 varchar：'1'/'0'（JeecgBoot 原样）
 */
@Entity('sys_depart')
export class DeptEntity {
  @ApiProperty({ description: '主键 ID（32 位字符串）', example: 'dept_1' })
  @PrimaryColumn({ type: 'varchar', length: 32, comment: 'ID' })
  id: string

  @ApiPropertyOptional({ description: '父机构 ID，null 为顶级', example: 'dept_1', nullable: true })
  @Column({ type: 'varchar', length: 32, nullable: true, comment: '父机构ID' })
  parentId?: string | null

  @ApiProperty({ description: '机构/部门名称', example: '研发部' })
  @Column({ length: 100, comment: '机构/部门名称' })
  departName: string

  @ApiPropertyOptional({ description: '英文名', nullable: true })
  @Column({ length: 500, nullable: true, comment: '英文名' })
  departNameEn?: string

  @ApiPropertyOptional({ description: '缩写', nullable: true })
  @Column({ length: 500, nullable: true, comment: '缩写' })
  departNameAbbr?: string

  @ApiPropertyOptional({ description: '排序', example: 0 })
  @Column({ type: 'int', default: 0, comment: '排序' })
  departOrder?: number

  @ApiPropertyOptional({ description: '描述 / 负责人', example: '负责人：李工', nullable: true })
  @Column({ length: 500, nullable: true, comment: '描述' })
  description?: string

  @ApiPropertyOptional({ description: '机构类别：1 公司 / 2 部门 / 3 岗位 / 4 子公司', example: '2', nullable: true })
  @Column({ length: 10, default: '1', comment: '机构类别 1公司，2部门，3岗位，4子公司' })
  orgCategory?: string

  @ApiPropertyOptional({ description: '树深度层级', example: '1', nullable: true })
  @Column({ length: 10, nullable: true, comment: '树深度层级level' })
  orgType?: string

  @ApiProperty({ description: '机构编码（唯一，空则自动生成，如 A01 / A01A01）', example: 'A01' })
  @Column({ length: 64, unique: true, comment: '机构编码' })
  orgCode: string

  @ApiPropertyOptional({ description: '手机号', example: '13800138000', nullable: true })
  @Column({ length: 32, nullable: true, comment: '手机号' })
  mobile?: string

  @ApiPropertyOptional({ description: '传真', nullable: true })
  @Column({ length: 32, nullable: true, comment: '传真' })
  fax?: string

  @ApiPropertyOptional({ description: '地址', nullable: true })
  @Column({ length: 100, nullable: true, comment: '地址' })
  address?: string

  @ApiPropertyOptional({ description: '备注', nullable: true })
  @Column({ length: 500, nullable: true, comment: '备注' })
  memo?: string

  @ApiPropertyOptional({ description: '状态：1 启用 / 0 不启用', example: '1', nullable: true })
  @Column({ length: 1, default: '1', comment: '状态（1启用，0不启用）' })
  status?: string

  @ApiPropertyOptional({ description: '删除状态：0 正常 / 1 已删除', example: '0', nullable: true })
  @Column({ length: 1, default: '0', comment: '删除状态（0，正常，1已删除）' })
  delFlag?: string

  @ApiPropertyOptional({ description: '创建人', nullable: true })
  @Column({ length: 32, nullable: true, comment: '创建人' })
  createBy?: string

  @ApiPropertyOptional({ description: '创建时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '创建日期' })
  createTime?: Date

  @ApiPropertyOptional({ description: '更新人', nullable: true })
  @Column({ length: 32, nullable: true, comment: '更新人' })
  updateBy?: string

  @ApiPropertyOptional({ description: '更新时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '更新日期' })
  updateTime?: Date

  @ApiPropertyOptional({ description: '租户 ID（对齐 JeecgBoot，默认 0）', example: 0, nullable: true })
  @Column({ type: 'int', default: 0, comment: '租户ID' })
  tenantId?: number

  @ApiPropertyOptional({ description: '是否有叶子节点：1 是 / 0 否', example: 0, nullable: true })
  @Column({ type: 'tinyint', default: 0, comment: '是否有叶子节点: 1是0否' })
  izLeaf?: number
}
```

### 6. `src/modules/system/dept/dept.service.ts`

```ts
import { Injectable, BadRequestException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull, Repository, type DeepPartial } from 'typeorm'

import { BaseService } from '../../../helper/crud/base.service'
import { UserEntity } from '../../user/entities/user.entity'
import { DeptEntity } from './entities/dept.entity'
import type { CreateDeptDto } from './dto/create-dept.dto'

export interface DeptTreeItem extends DeptEntity {
  children: DeptTreeItem[]
}

/** 顶级部门的 parent_id 约定（JeecgBoot 用 null 或空串） */
function isRootParent(parentId?: string | null): boolean {
  return parentId === null || parentId === undefined || parentId === ''
}

@Injectable()
export class DeptService extends BaseService<DeptEntity> {
  constructor(
    @InjectRepository(DeptEntity)
    repository: Repository<DeptEntity>
  ) {
    super(repository, '部门')
  }

  /** 创建：校验父级存在、自动生成 orgCode */
  async create(dto: CreateDeptDto): Promise<DeptEntity> {
    const parentId = dto.parentId || null
    if (parentId) {
      await this.findOne(parentId)
    }
    const orgCode = dto.orgCode || (await this.generateOrgCode(parentId))
    return super.create({
      ...dto,
      parentId,
      orgCode,
      status: dto.status ?? '1',
      delFlag: '0',
      orgCategory: dto.orgCategory ?? '2',
      createTime: new Date()
    })
  }

  /** 更新：父级不能指向自己或自己的后代（防环）；改父级时同步重算 orgCode */
  async update(id: string, dto: DeepPartial<DeptEntity>): Promise<DeptEntity> {
    if (dto.parentId !== undefined) {
      const parentId = dto.parentId || null
      if (parentId === id) {
        throw new BadRequestException('父级部门不能是自身')
      }
      if (parentId) {
        await this.findOne(parentId)
        const all = await this.repository.find()
        const descendantIds = this.collectDescendantIds(all, id)
        if (descendantIds.has(parentId)) {
          throw new BadRequestException('父级部门不能是自己的下级')
        }
      }
      dto.parentId = parentId
      if (!dto.orgCode) {
        dto.orgCode = await this.generateOrgCode(parentId)
      }
    }
    dto.updateTime = new Date()
    return super.update(id, dto)
  }

  /** 删除：有下级或挂了用户时不允许删（软删，置 del_flag='1'） */
  async delete(id: string): Promise<void> {
    await this.findOne(id)
    const childCount = await this.repository.count({ where: { parentId: id, delFlag: '0' } })
    if (childCount > 0) {
      throw new BadRequestException('该部门下存在子部门，无法删除')
    }
    const userCount = await this.repository.manager.count(UserEntity, { where: { deptId: id } })
    if (userCount > 0) {
      throw new BadRequestException('该部门下存在用户，无法删除')
    }
    await this.repository.update(id, { delFlag: '1' })
  }

  /** 全量部门（按 depart_order 升序，排除已删除） */
  async listAll(): Promise<DeptEntity[]> {
    return this.repository.find({ where: { delFlag: '0' }, order: { departOrder: 'ASC', id: 'ASC' } })
  }

  /** 扁平列表转树（parent_id 为 null/'' 视为顶级） */
  async getTree(): Promise<DeptTreeItem[]> {
    const all = await this.listAll()
    return buildDeptTree(all, null)
  }

  /** 顶级部门 */
  async listRoots(): Promise<DeptEntity[]> {
    return this.repository.find({ where: { parentId: IsNull(), delFlag: '0' }, order: { departOrder: 'ASC' } })
  }

  /**
   * 生成机构编码，JeecgBoot 风格两位字母递增：
   * - 顶级：A01、A02 ...
   * - 子级：父编码 + A01（如 A01A01）
   */
  private async generateOrgCode(parentId: string | null): Promise<string> {
    const siblings = await this.repository.find({ where: parentId ? { parentId } : { parentId: IsNull() } })
    let prefix = 'A'
    if (parentId) {
      const parent = await this.repository.findOne({ where: { id: parentId } })
      if (!parent) {
        throw new BadRequestException('父级部门不存在')
      }
      prefix = parent.orgCode
    }
    let index = siblings.length + 1
    let code = `${prefix}A${String(index).padStart(2, '0')}`
    while ((await this.repository.count({ where: { orgCode: code } })) > 0) {
      index++
      code = `${prefix}A${String(index).padStart(2, '0')}`
    }
    return code
  }

  /** 收集某部门所有后代 id */
  private collectDescendantIds(all: DeptEntity[], rootId: string): Set<string> {
    const result = new Set<string>()
    const walk = (parentId: string) => {
      for (const dept of all) {
        if (dept.parentId === parentId && !result.has(dept.id)) {
          result.add(dept.id)
          walk(dept.id)
        }
      }
    }
    walk(rootId)
    return result
  }
}

/** list-to-tree：一次取全量后内存组装，不递归查库 */
export function buildDeptTree(all: DeptEntity[], parentId: string | null): DeptTreeItem[] {
  return all
    .filter(dept => (parentId === null ? isRootParent(dept.parentId) : dept.parentId === parentId))
    .map(dept =>
      // 实体实例展开为 plain object 组树（响应走 JSON 序列化，无原型丢失问题）
      // oxlint-disable-next-line typescript(no-misused-spread)
      ({
        ...dept,
        children: buildDeptTree(all, dept.id)
      })
    )
}
```

**学习点**

- `org_code` 是 NOT NULL + UNIQUE，但又希望「不填自动生成」，所以生成逻辑必须在 Service 层，并且带 `while` 冲突自增（并发/历史数据都能兜住）。
- 删除改软删（`del_flag='1'`），列表/树查询全部带 `del_flag='0'`，否则删掉的部门又冒出来。

### 7. 守卫改造

`src/common/guards/roles.guard.ts`

```ts
const userRoles: string[] = user?.roles?.map((role: { roleCode: string }) => role.roleCode) ?? []
```

`src/common/guards/perms.guard.ts`

```ts
// admin 角色拥有全部按钮权限
if (roles.some((role: { roleCode: string }) => role.roleCode === 'admin')) {
  return true
}

const roleIds = roles.map((role: { id: string }) => role.id)
// 实时查库：角色 → sys_role_permission → sys_permission.perms（无效/已删除菜单不算数）
const rows = await this.dataSource
  .createQueryBuilder()
  .select('p.perms', 'perms')
  .from('sys_permission', 'p')
  .innerJoin('sys_role_permission', 'rp', 'rp.permission_id = p.id')
  .where('rp.role_id IN (:...roleIds)', { roleIds })
  .andWhere("p.status = '1'")
  .andWhere('p.del_flag = 0')
  .getRawMany<PermRow>()

const owned = new Set(rows.map(row => row.perms).filter((p): p is string => !!p))
```

**学习点**

- `@Roles('admin')` 现在匹配的是 `sys_role.role_code`，不是原来的 `role.name`。
- 权限守卫每请求实时查库（不缓存），所以角色改权限**立即生效**，无需重新登录；但 `@Roles` 读的是 JWT 校验时加载的角色，登录态不变。

### 8. `src/helper/crud/base.service.ts` 自动生成字符串主键

```ts
  /** 创建：字符串主键实体自动生成 32 位 id（数字自增主键不干预） */
  async create(dto: DeepPartial<T>): Promise<T> {
    const entity = this.repository.create(dto)
    if (!entity.id && this.hasStringPrimaryKey()) {
      Object.assign(entity, { id: randomId32() })
    }
    return this.repository.save(entity)
  }

  /** 主键是否为字符串列（varchar/char）——用于决定是否自动生成 id */
  private hasStringPrimaryKey(): boolean {
    const column = this.repository.metadata.findColumnWithPropertyName('id')
    return !!column && (column.type === 'varchar' || column.type === 'char')
  }
```

**学习点**

- 用元数据判断主键类型，而不是给每个 Service 手写 id 生成；数字自增主键（如 `login_log`）完全不受影响。

### 9. 迁移 1：`src/migrations/1793766529976-Migration.ts`（核心片段）

```ts
/* ---------------- 1. sys_role ---------------- */
await queryRunner.query('DROP TABLE IF EXISTS `sys_role`')
await queryRunner.query(`CREATE TABLE \`sys_role\` (
  \`id\` varchar(32) NOT NULL COMMENT '主键id',
  \`role_name\` varchar(200) DEFAULT NULL COMMENT '角色名称',
  \`role_code\` varchar(100) NOT NULL COMMENT '角色编码',
  \`description\` varchar(255) DEFAULT NULL COMMENT '描述',
  \`create_by\` varchar(32) DEFAULT NULL COMMENT '创建人',
  \`create_time\` datetime DEFAULT NULL COMMENT '创建时间',
  \`update_by\` varchar(32) DEFAULT NULL COMMENT '更新人',
  \`update_time\` datetime DEFAULT NULL COMMENT '更新时间',
  \`tenant_id\` int DEFAULT '0' COMMENT '租户ID',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uniq_sys_role_role_code\` (\`role_code\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色表'`)

// 旧 role.name → 新 role_code；admin 沿用 JeecgBoot 初始 id，其余 UUID
await queryRunner.query(`INSERT INTO \`sys_role\` (\`id\`, \`role_name\`, \`role_code\`, \`description\`, \`create_by\`, \`create_time\`, \`update_by\`, \`update_time\`, \`tenant_id\`)
  SELECT CASE WHEN \`name\` = 'admin' THEN 'f6817f48af4fb3af11b9e8bf182f618b' ELSE REPLACE(UUID(), '-', '') END,
         \`label\`, \`name\`, \`remark\`, 'admin', NOW(), 'admin', NOW(), 0
  FROM \`role\``)

/* ---------------- 2. sys_user_role（替换 user_roles） ---------------- */
await queryRunner.query(`CREATE TABLE \`sys_user_role\` (
  \`id\` varchar(32) NOT NULL DEFAULT (replace(uuid(),'-','')) COMMENT '主键id',
  \`user_id\` varchar(32) DEFAULT NULL COMMENT '用户id',
  \`role_id\` varchar(32) DEFAULT NULL COMMENT '角色id',
  \`tenant_id\` int DEFAULT '0' COMMENT '租户ID',
  PRIMARY KEY (\`id\`),
  KEY \`idx_sur_user_id\` (\`user_id\`),
  KEY \`idx_sur_role_id\` (\`role_id\`),
  UNIQUE KEY \`uniq_sur_user_role\` (\`user_id\`,\`role_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户角色表'`)

await queryRunner.query(`INSERT INTO \`sys_user_role\` (\`user_id\`, \`role_id\`, \`tenant_id\`)
  SELECT ur.\`user_id\`, r.\`id\`, 0
  FROM \`user_roles\` ur
  JOIN \`role\` o ON o.\`id\` = ur.\`role_id\`
  JOIN \`sys_role\` r ON r.\`role_code\` = o.\`name\``)

/* ---------------- 3. sys_permission（替换 menu） ---------------- */
await queryRunner.query(`INSERT INTO \`sys_permission\`
  (\`id\`, \`parent_id\`, \`name\`, \`url\`, \`component\`, \`is_route\`, \`menu_type\`, \`perms\`, \`perms_type\`,
   \`sort_no\`, \`icon\`, \`is_leaf\`, \`keep_alive\`, \`hidden\`, \`del_flag\`, \`rule_flag\`, \`status\`,
   \`create_by\`, \`create_time\`, \`update_by\`, \`update_time\`)
  SELECT CONCAT('menu_', m.\`id\`),
         CASE WHEN m.\`parent_id\` > 0 THEN CONCAT('menu_', m.\`parent_id\`) ELSE NULL END,
         m.\`name\`, m.\`path\`, m.\`component\`, 1, m.\`type\`, m.\`permission\`, '1',
         m.\`sort\`, m.\`icon\`, IF(m.\`type\` = 2, 1, 0), 0, 0, 0, 0, IF(m.\`status\` = 1, '1', '0'),
         'admin', m.\`created_at\`, 'admin', m.\`updated_at\`
  FROM \`menu\` m`)

/* ---------------- 4. sys_role_permission（替换 role_menus） ---------------- */
await queryRunner.query(`INSERT INTO \`sys_role_permission\` (\`role_id\`, \`permission_id\`, \`operate_date\`)
  SELECT r.\`id\`, CONCAT('menu_', rm.\`menu_id\`), NOW()
  FROM \`role_menus\` rm
  JOIN \`role\` o ON o.\`id\` = rm.\`role_id\`
  JOIN \`sys_role\` r ON r.\`role_code\` = o.\`name\``)

/* ---------------- 5. 旧表退场 ---------------- */
await queryRunner.query('DROP TABLE IF EXISTS `role_menus`')
await queryRunner.query('DROP TABLE IF EXISTS `user_roles`')
await queryRunner.query('DROP TABLE IF EXISTS `menu`')
await queryRunner.query('DROP TABLE IF EXISTS `role`')

/* ---------------- 6. sys_depart（替换 dept）---------------- */
// 机构编码按树层级生成（A01 / A01A01）
const oldDepts = await queryRunner.query('SELECT `id`, `name`, `parent_id`, `sort`, `leader`, `phone`, `status`, `created_at`, `updated_at` FROM `dept` ORDER BY `id`')
const childrenOf = (parentId: number) => oldDepts.filter(d => d.parent_id === parentId)
const rows: Array<[string, string | null, string, number, number, string | null, string | null, string, Date, Date]> = []
const walk = (parentId: number, parentCode: string | null) => {
  childrenOf(parentId).forEach((dept, index) => {
    const code = `${parentCode ?? ''}A${String(index + 1).padStart(2, '0')}`
    rows.push([
      `dept_${dept.id}`, parentId === 0 ? null : `dept_${parentId}`, dept.name, dept.sort ?? 0,
      dept.status === 1 ? 1 : 0, dept.leader, dept.phone, code, dept.created_at, dept.updated_at
    ])
    walk(dept.id, code)
  })
}
walk(0, null)

for (const row of rows) {
  await queryRunner.query(
    `INSERT INTO \`sys_depart\` (\`id\`, \`parent_id\`, \`depart_name\`, \`depart_order\`, \`status\`, \`description\`, \`mobile\`, \`org_code\`, \`org_category\`, \`del_flag\`, \`create_by\`, \`create_time\`, \`update_by\`, \`update_time\`)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2', '0', 'admin', ?, 'admin', ?)`,
    [row[0], row[1], row[2], row[3], row[4] === 1 ? '1' : '0', row[5] ? `负责人：${row[5]}` : null, row[6], row[7], row[8], row[9]]
  )
}

// 用户归属部门：dept_id 改 varchar 并重写，org_code 从部门带出
await queryRunner.query("ALTER TABLE `sys_user` MODIFY COLUMN `dept_id` varchar(32) DEFAULT NULL COMMENT '所属部门ID（sys_depart.id，本项目扩展）'")
await queryRunner.query("UPDATE `sys_user` SET `dept_id` = CONCAT('dept_', `dept_id`) WHERE `dept_id` IS NOT NULL AND `dept_id` <> ''")
await queryRunner.query('UPDATE `sys_user` u JOIN `sys_depart` d ON d.`id` = u.`dept_id` SET u.`org_code` = d.`org_code`')

await queryRunner.query('DROP TABLE IF EXISTS `dept`')
```

`down()` 做了完整反向：按 `SUBSTRING(id, 6)` 把 `menu_` / `dept_` 前缀还原成旧数字 id，角色则按 `role_code` 用自增 id 重建，再回灌 `user_roles` / `role_menus`。

### 10. 迁移 2：`src/migrations/1793767136137-Migration.ts`（去重 + 唯一索引）

```ts
// sys_user_role：保留每组 (user_id, role_id) 中 id 最小的一行
await queryRunner.query(`DELETE u1 FROM \`sys_user_role\` u1
  JOIN \`sys_user_role\` u2
    ON u1.\`user_id\` = u2.\`user_id\` AND u1.\`role_id\` = u2.\`role_id\` AND u1.\`id\` > u2.\`id\``)
await queryRunner.query('ALTER TABLE `sys_user_role` DROP INDEX `idx_sur_user_role_id`')
await queryRunner.query('ALTER TABLE `sys_user_role` ADD UNIQUE KEY `uniq_sur_user_role` (`user_id`, `role_id`)')

// sys_role_permission：同上
await queryRunner.query(`DELETE r1 FROM \`sys_role_permission\` r1
  JOIN \`sys_role_permission\` r2
    ON r1.\`role_id\` = r2.\`role_id\` AND r1.\`permission_id\` = r2.\`permission_id\` AND r1.\`id\` > r2.\`id\``)
await queryRunner.query('ALTER TABLE `sys_role_permission` DROP INDEX `idx_srp_role_per_id`')
await queryRunner.query('ALTER TABLE `sys_role_permission` ADD UNIQUE KEY `uniq_srp_role_permission` (`role_id`, `permission_id`)')
```

---

## 四、数据迁移规则（旧 → 新）

| 对象 | 规则 | 迁移后实际 id |
| --- | --- | --- |
| 角色 admin | 固定 JeecgBoot id | `f6817f48af4fb3af11b9e8bf182f618b` |
| 其他角色 | `REPLACE(UUID(),'-','')` | viewer/editor/auditor 各 32 位 |
| 菜单 | `CONCAT('menu_', 旧id)` | `menu_1` … `menu_34`（32 条） |
| 菜单父级 | `parent_id = 0` → `NULL` | 系统管理为顶级 |
| 部门 | `CONCAT('dept_', 旧id)` | `dept_1` … `dept_5` |
| 部门编码 | 按树层级生成 | 总公司 A01/A02，研发部 A01A01/A01A02，测试部 A01A03 |
| 用户部门 | `dept_id` 加 `dept_` 前缀 | admin → `dept_1` |
| 负责人 | 旧 `leader` 无对应列 | 写入 `description = '负责人：xxx'` |

---

## 五、接口变化（前端需要同步）

| 接口 | 变化 |
| --- | --- |
| `GET /api/roles` | 元素字段 `name/label/status/remark` → `roleCode/roleName/description`，`menus` → `permissions` |
| `POST /api/roles` | 请求体 `{ roleName, roleCode, description, menuIds: string[] }` |
| `PUT /api/roles/:id/menus` | `menuIds` 变字符串数组，**真正全量覆盖** |
| `GET /api/menus/tree` | 字段 `type/path/permission/sort` → `menuType/url/perms/sortNo`；`status` 为 `'1'/'0'` |
| `GET /api/depts/tree` | 字段 `name/sort/phone/leader` → `departName/departOrder/mobile/description`；新增 `orgCode` |
| `POST /api/depts` | `parentId` 不传即顶级；`orgCode` 不传自动生成 |
| `GET /api/users` | `deptId` 过滤值变字符串（`dept_1`） |
| 所有 `:id` 路径参数 | 由数字改为 32 位字符串（不再有 `ParseIntPipe`） |

---

## 六、遇到的坑（都踩过一遍）

1. **可空联合类型导致 `design:type = Object`**
   `parentId?: string | null` 编译后元数据是 `Object`，TypeORM 启动直接抛 `Data type "Object" in "DeptEntity.parentId" is not supported`。修法：显式 `@Column({ type: 'varchar', length: 32 })`。

2. **新表排序规则与旧表不一致**
   `CREATE TABLE ... DEFAULT CHARSET=utf8mb4` 在 MySQL 8 下默认 `utf8mb4_0900_ai_ci`，与库里原有的 `utf8mb4_unicode_ci` 做 JOIN 时报 `Illegal mix of collations`。修法：所有建表语句显式 `COLLATE=utf8mb4_unicode_ci`。

3. **`addAndRemove(a, [])` 不是「全量覆盖」**
   旧实现只加不减，且会重复插入已存在的关联行（editor 一度出现 3 行）。修法：自己算 `toAdd`/`toRemove` 差集 + 关联表加唯一索引。

4. **默认值被 `undefined` 覆盖**
   `{ ...默认值, ...dto }` 中 DTO 的 `status: undefined` 会把默认值抹掉，落库 `NULL`，按钮权限判定（要求 `status='1'`）直接失效。修法：展开在前，默认值用 `??` 兜底在后。

5. **`@JoinTable` 列名必须显式**
   JeecgBoot 用 `role_id`/`permission_id`，TypeORM 默认会生成 `roleId`/`menuId`，不写死会 `Unknown column`。

6. **关联表带独立 id 又要能被 TypeORM 插入**
   JeecgBoot 关联表主键是 `id varchar(32)`，TypeORM 的 `@JoinTable` 只插两列外键，`id` 若 NOT NULL 无默认值会报错。修法：`DEFAULT (replace(uuid(),'-',''))`（MySQL 8 表达式默认值）。

---

## 七、验证记录（全部实测通过）

```
登录 admin/123456                     → TOKEN 正常，profile roles=["admin"]，deptId=dept_1
GET  /api/menus/tree                  → 系统管理[0] 7 个子菜单，层级正确
GET  /api/depts/tree                  → 总公司(A01)[测试部:A01A03,研发部:A01A01,研发部:A01A02] | 总公司(A02)[]
GET  /api/roles                       → viewer/editor/auditor/admin，permissions 数量正确
POST /api/users（roleIds/deptId 字符串）→ 落库正确，返回 dept=研发部、roles=["viewer"]
viewer 无日志导出权限                   → GET /api/logs/login/export 返回 403「无操作权限」
授权 menu_20 后（同一 token，权限实时生效）→ 200 且 CSV 内容正确
POST /api/depts（不传 orgCode）         → 自动生成 A02A01
PUT  /api/depts/dept_1 {parentId:dept_2} → 400「父级部门不能是自己的下级」
DELETE /api/depts/dept_1                → 400「该部门下存在子部门，无法删除」
POST/PUT/DELETE /api/menus              → status 默认 '1'，字段更新与删除正常
连续两次相同授权                         → 关联表行数不增长（幂等）
```

---

## 八、怎么继续 / 怎么用

- **加一个按钮权限**：`POST /api/menus`，`menuType: 2`、`parentId` 指向所属菜单、`perms: 'system:xxx:yyy'`，然后在角色管理里授权即可；后端接口加 `@Perms('system:xxx:yyy')`。
- **给角色授权**：`PUT /api/roles/{roleCode 对应的 id}/menus`，传完整 `menuIds` 数组（全量覆盖）。
- **新建部门**：`POST /api/depts`，只传 `departName` 和 `parentId`（顶级不传），`orgCode` 自动按层级生成；需要手工编码时显式传。
- **下一步可做**：`dict` 对齐 `sys_dict` / `sys_dict_item`、`notice` 对齐 `sys_annountcement`、`oper_log` 对齐 `sys_log`。
