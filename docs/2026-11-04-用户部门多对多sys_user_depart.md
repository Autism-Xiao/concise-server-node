# 用户部门改多对多（对齐 JeecgBoot sys_user_depart）

> 目标：把 `sys_user.dept_id`（单部门扩展列）换成 JeecgBoot 原生的 `sys_user_depart` 中间表，
> 一个用户可挂多个部门；主部门的机构编码冗余到 `sys_user.org_code`，供后续数据权限过滤。

## 一、改了哪些文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/migrations/1793767900000-Migration.ts` | 新增 | 建 `sys_user_depart`、存量 `dept_id` 搬进关联表、回填 `depart_ids`/`org_code`、删除 `dept_id` 列 |
| `src/modules/user/entities/user.entity.ts` | 修改 | 删 `deptId` 列与 `dept` 单值关联；加 `orgCode`、`departIds` 列；加 `depts` 多对多（`sys_user_depart`）；保留 `dept` 兼容字段（非列） |
| `src/modules/system/dept/entities/dept.entity.ts` | 修改 | 加 `users` 反向多对多关系（TypeORM 关系映射必需） |
| `src/modules/user/user.service.ts` | 修改 | 新增 `assignDepts`/`attachDepts`/`applyDepts`/`orderDepts`；创建/更新支持 `deptIds`；列表按关联表过滤；登录/详情/列表统一带出部门并按主次排序 |
| `src/modules/user/user.controller.ts` | 修改 | 新增 `PUT /api/users/:id/depts`（全量覆盖部门） |
| `src/modules/user/user.module.ts` | 修改 | `forFeature` 增加 `DeptEntity`（跨模块注入 Repository 的前提） |
| `src/modules/user/dto/create-user.dto.ts` | 修改 | `deptId` → `deptIds: string[]`；`deptId` 保留为 deprecated 兼容字段 |
| `src/modules/user/dto/query-user.dto.ts` | 修改 | 新增 `deptIds`（逗号分隔多选），`deptId` 继续可用 |
| `src/modules/system/dept/dept.service.ts` | 修改 | 删除保护改查 `sys_user_depart` 且排除软删用户；`orgCode` 变化时同步用户 `org_code` |
| `docs/2026-11-04-用户部门多对多sys_user_depart.md` | 新增 | 本文档 |
| `docs/README.md` | 修改 | 索引登记 |

数据库变化：

| 对象 | 变化 |
| --- | --- |
| `sys_user_depart` | 新建：`ID varchar(32)` 主键（DB 默认 `replace(uuid(),'-','')`）、`user_id`、`dep_id`、唯一键 `(user_id, dep_id)` |
| `sys_user.dept_id` | 数据搬走后 **DROP COLUMN** |
| `sys_user.depart_ids` | 由迁移回填，之后由 `assignDepts` 维护（逗号串，顺序即主次） |
| `sys_user.org_code` | 由迁移回填，之后由 `assignDepts` 维护（主部门机构编码） |

## 二、每个东西是干什么的

### 1. 为什么不用 `dept_id` 了

- JeecgBoot 原版 `sys_user` 没有 `dept_id`，部门关系在 `sys_user_depart(user_id, dep_id)`，一个人可以同时挂研发部 + 测试部（兼职、矩阵管理）。
- `dept_id` 与 `org_code` 双份真相：改部门只写 `dept_id`，`org_code` 不会跟着变，数据权限迟早出错。
- 改完后只保留一个关系数据源（中间表），两个冗余列（`depart_ids`、`org_code`）都由同一段代码写，不会再各说各话。

### 2. `sys_user_depart` 表结构（照搬 JeecgBoot）

```sql
CREATE TABLE `sys_user_depart` (
  `ID` varchar(32) NOT NULL DEFAULT (replace(uuid(),'-','')) COMMENT 'id',
  `user_id` varchar(32) DEFAULT NULL COMMENT '用户id',
  `dep_id` varchar(32) DEFAULT NULL COMMENT '部门id',
  PRIMARY KEY (`ID`),
  UNIQUE KEY `idx_sud_user_dep_id` (`user_id`,`dep_id`),
  KEY `idx_sud_user_id` (`user_id`),
  KEY `idx_sud_dep_id` (`dep_id`)
) COMMENT='用户-部门关系表';
```

`ID` 的默认值表达式是关键：TypeORM 的 `@ManyToMany` 插入关联行时只写 `user_id` / `dep_id`，
如果 `ID` 无默认值就一定会报 `Field 'ID' doesn't have a default value`。
`sys_user_role` 之前也是同样的处理方式，保持一致。

### 3. 实体层

- `UserEntity.depts`：`@ManyToMany(() => DeptEntity) + @JoinTable({ name: 'sys_user_depart', joinColumns: user_id, inverseJoinColumns: dep_id })`，是「关系数据源」。
- `UserEntity.departIds`：`varchar(1000)`，存 `dept_2,dept_4` 这种有序串，**第一个就是主部门**（中间表无法表达顺序）。
- `UserEntity.orgCode`：主部门机构编码冗余，给数据权限/报表直接过滤用，避免每次 join 部门。
- `UserEntity.dept`：**非数据库列**，Service 里赋值为 `depts[0]`，只为兼容旧前端/旧接口里单个 `dept` 的返回结构。
- `DeptEntity.users`：反向关系，TypeORM 多对多必须两侧都声明。

### 4. Service 层

| 方法 | 职责 |
| --- | --- |
| `create(dto, operator)` | 拆出 `roleIds`/`deptIds`/`deptId`，主表照常插入，再分别写角色表、部门表 |
| `assignDepts(id, deptIds)` | **全量覆盖**：查库校验部门有效（未删）→ 按入参顺序算差集 `addAndRemove` → 回写 `depart_ids` + `org_code` |
| `assignRoles(id, roleIds)` | 原有逻辑，未改动 |
| `listByQuery(query)` | 部门过滤改 `EXISTS (SELECT 1 FROM sys_user_depart ...)`，分页后统一补部门 |
| `attachDepts(users)` | 列表页一次查完所有关联，避免 N+1 |
| `applyDepts(user)` | 单条记录：按 `depart_ids` 排序 + 设置 `dept` 兼容字段 |
| `orderDepts(depts, departIds)` | 按 `depart_ids` 的顺序排序，关联表里没有登记的排最后 |
| `stripUnwritableFields(data)` | 拒绝客户端直接写 `depts`/`dept`/`departIds`/`orgCode`，这两个冗余列只能由 `assignDepts` 写 |
| `findByUsername` / `findOneWithRoles` / `findOneDetail` | 都带出 `depts` 并排序，登录返回、`/auth/profile`、用户详情结构一致 |

### 5. 接口变化

| 接口 | 变化 |
| --- | --- |
| `POST /api/users` | body 用 `deptIds: string[]`（顺序=主次）；旧 `deptId` 仍可用（自动包成单元素数组） |
| `PUT /api/users/:id` | 传 `deptIds`（含 `[]` 表示清空）才重绑部门；不传则保持原样 |
| `PUT /api/users/:id/depts` | 新增，body `{ "deptIds": ["dept_2","dept_4"] }`，全量覆盖 |
| `GET /api/users` | 支持 `deptId`（单个）与 `deptIds`（逗号分隔多个，取并集）；`items[].depts` 数组 + `items[].dept` 主部门 |
| `GET /api/users/:id`、`GET /auth/profile` | 返回 `depts` + `dept` + `departIds` + `orgCode` |
| `DELETE /api/depts/:id` | 保护逻辑改查关联表，并排除已软删用户（修掉「删过的人挡住部门删除」的误判） |

## 三、完整代码

### 3.1 `src/migrations/1793767900000-Migration.ts`

```ts
import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 用户-部门改多对多（对齐 JeecgBoot sys_user_depart）
 *
 * 背景：此前 sys_user.dept_id 是「单部门」扩展列，JeecgBoot 原生用中间表 sys_user_depart，
 * 一个用户可挂多个部门；主部门（depart_ids 第一个）的机构编码冗余到 sys_user.org_code 供数据权限过滤。
 *
 * 表结构完全照搬 JeecgBoot：ID varchar(32) 主键（DB 默认 replace(uuid(),'-','') 生成，TypeORM
 * 多对多插入只写 user_id / dep_id 也不会失败）、user_id+dep_id 唯一键。
 *
 * up  ：建表 → 把存量 dept_id 搬进关联表 → 回填 depart_ids / org_code → 删除 dept_id 列
 * down：加回 dept_id → 用 depart_ids 首个部门回填 → 删除关联表
 */
export class Migration1793767900000 implements MigrationInterface {
  name = 'Migration1793767900000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`sys_user_depart\` (
      \`ID\` varchar(32) NOT NULL DEFAULT (replace(uuid(),'-','')) COMMENT 'id',
      \`user_id\` varchar(32) DEFAULT NULL COMMENT '用户id',
      \`dep_id\` varchar(32) DEFAULT NULL COMMENT '部门id',
      PRIMARY KEY (\`ID\`),
      UNIQUE KEY \`idx_sud_user_dep_id\` (\`user_id\`,\`dep_id\`),
      KEY \`idx_sud_user_id\` (\`user_id\`),
      KEY \`idx_sud_dep_id\` (\`dep_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户-部门关系表'`)

    // 存量单部门数据搬到关联表（重复执行安全）
    await queryRunner.query(`INSERT IGNORE INTO \`sys_user_depart\` (\`user_id\`, \`dep_id\`)
      SELECT u.\`id\`, u.\`dept_id\` FROM \`sys_user\` u
      WHERE u.\`dept_id\` IS NOT NULL AND u.\`dept_id\` <> ''`)

    // 回填部门集合与机构编码冗余（只有本次搬过来的用户需要）
    await queryRunner.query(`UPDATE \`sys_user\` u
      JOIN \`sys_user_depart\` ud ON ud.\`user_id\` = u.\`id\`
      LEFT JOIN \`sys_depart\` d ON d.\`id\` = ud.\`dep_id\`
      SET u.\`depart_ids\` = ud.\`dep_id\`, u.\`org_code\` = d.\`org_code\`
      WHERE u.\`dept_id\` IS NOT NULL AND u.\`dept_id\` <> ''`)

    // 旧列已无意义，删掉避免「双份真相」
    await queryRunner.query('ALTER TABLE `sys_user` DROP COLUMN `dept_id`')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `sys_user` ADD COLUMN `dept_id` varchar(32) DEFAULT NULL COMMENT '所属部门ID（旧版单部门列，已废弃）'"
    )
    await queryRunner.query(`UPDATE \`sys_user\` SET \`dept_id\` = SUBSTRING_INDEX(\`depart_ids\`, ',', 1)
      WHERE \`depart_ids\` IS NOT NULL AND \`depart_ids\` <> ''`)
    await queryRunner.query('DROP TABLE IF EXISTS `sys_user_depart`')
  }
}
```

### 3.2 `src/modules/user/entities/user.entity.ts`

```ts
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
```

### 3.3 `src/modules/system/dept/entities/dept.entity.ts`（末尾新增反向关系，其余字段不变）

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, ManyToMany, PrimaryColumn } from 'typeorm'
import { UserEntity } from '../../../user/entities/user.entity'

/**
 * 组织机构表（对齐 JeecgBoot sys_depart）
 * - 主键 32 位字符串；parent_id 为 null/'' 视为顶级
 * - org_code 唯一且必填（JeecgBoot 用它做机构编码，也用于用户 sys_user.org_code）
 * - status / del_flag 为 varchar：'1'/'0'（JeecgBoot 原样）
 * - 部门↔用户走 sys_user_depart（dep_id + user_id），一个部门可挂多个用户
 */
@Entity('sys_depart')
export class DeptEntity {
  // ……（id / parentId / departName / orgCode 等字段与上一版一致，略）……

  @ApiPropertyOptional({ description: '是否有叶子节点：1 是 / 0 否', example: 0, nullable: true })
  @Column({ type: 'tinyint', default: 0, comment: '是否有叶子节点: 1是0否' })
  izLeaf?: number

  /** 反向关系：仅用于 TypeORM 关系映射，不参与 JSON 序列化场景（不加载即不出现） */
  @ManyToMany(() => UserEntity, user => user.depts)
  users?: UserEntity[]
}
```

> 注意：文件顶部必须加 `ManyToMany` 导入，并新增 `import { UserEntity } from '../../../user/entities/user.entity'`
> （三级 `../`：entities → dept → system → modules）。

### 3.4 `src/modules/user/user.service.ts`

```ts
import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'

import { BusinessException } from '../../common/exceptions/business.exception'
import { BaseService } from '../../helper/crud/base.service'
import { paginate, type PaginateOptions, type Pagination } from '../../helper/paginate'
import { encryptPassword, randomId32, randomSalt } from '../../utils/password.util'
import { DeptEntity } from '../system/dept/entities/dept.entity'
import { UserEntity } from './entities/user.entity'
import { RoleEntity } from '../role/entities/role.entity'
import type { QueryUserDto } from './dto/query-user.dto'

/** 用户状态（对齐 sys_user）：1 正常 / 2 冻结 */
export const USER_STATUS = { NORMAL: 1, FROZEN: 2 } as const

/**
 * 创建/更新入参
 * - 实体字段之外，附带角色、部门 id 列表（关联关系不落在主表，需单独写关联表）
 * - deptId 为旧字段，等价 deptIds: [deptId]
 */
type UserWriteInput = Partial<UserEntity> & { roleIds?: string[]; deptIds?: string[]; deptId?: string }

/** 归一化部门 id：deptIds 优先，其次兼容单个 deptId；去重去空并保持入参顺序（首个为主部门） */
function normalizeDeptIds(deptIds?: string[], deptId?: string): string[] {
  return [...new Set((deptIds ?? (deptId ? [deptId] : [])).filter(Boolean))]
}

@Injectable()
export class UserService extends BaseService<UserEntity> {
  constructor(
    @InjectRepository(UserEntity)
    repository: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    @InjectRepository(DeptEntity)
    private readonly deptRepository: Repository<DeptEntity>
  ) {
    super(repository, '用户')
  }

  /** 创建：生成 32 位主键与密码盐，密码按 JeecgBoot 算法 PBEWithMD5AndDES(username, password, salt) 入库 */
  async create(dto: UserWriteInput, operator?: string): Promise<UserEntity> {
    const { roleIds, deptIds, deptId, ...rest } = dto
    const data: Partial<UserEntity> = { ...rest }
    this.stripUnwritableFields(data)
    data.id = data.id || randomId32()
    data.salt = randomSalt()
    if (data.password) {
      data.password = encryptPassword(data.username as string, data.password, data.salt)
    }
    data.status = data.status || USER_STATUS.NORMAL
    data.delFlag = 0
    if (operator) {
      data.createBy = operator
      data.updateBy = operator
    }
    if (!data.createTime) {
      data.createTime = new Date()
    }
    const user = await super.create(data)
    if (roleIds?.length) {
      await this.assignRoles(user.id, roleIds)
    }
    const nextDeptIds = normalizeDeptIds(deptIds, deptId)
    if (nextDeptIds.length) {
      await this.assignDepts(user.id, nextDeptIds)
    }
    return this.findOneDetail(user.id) as Promise<UserEntity>
  }

  /** 更新：若携带密码则生成新盐重新加密；携带 roleIds / deptIds 则重绑关联 */
  async update(id: string, dto: UserWriteInput, operator?: string): Promise<UserEntity> {
    const { roleIds, deptIds, deptId, ...rest } = dto
    const data: Partial<UserEntity> = { ...rest }
    this.stripUnwritableFields(data)
    delete data.username // 账号不允许修改（密码算法绑定 username）
    if (data.password) {
      data.salt = randomSalt()
      const user = await this.findOneWithPassword(id)
      data.password = encryptPassword(user?.username ?? '', data.password, data.salt)
    }
    if (operator) {
      data.updateBy = operator
    }
    data.updateTime = new Date()
    await super.update(id, data)
    if (roleIds) {
      await this.assignRoles(id, roleIds)
    }
    // 传了 deptIds（含空数组）或旧字段 deptId 才重绑部门；都不传则保持原样
    if (deptIds !== undefined || deptId !== undefined) {
      await this.assignDepts(id, normalizeDeptIds(deptIds, deptId))
    }
    return this.findOneDetail(id) as Promise<UserEntity>
  }

  /** 绑定角色（全量覆盖：多退少补） */
  async assignRoles(id: string, roleIds: string[]): Promise<void> {
    await this.findOne(id)
    const roles = await this.roleRepository.findBy({ id: In(roleIds) })
    const nextIds = new Set(roleIds)
    const current = await this.repository.createQueryBuilder().relation(UserEntity, 'roles').of(id).loadMany<RoleEntity>()
    const currentIds = new Set(current.map(role => role.id))
    // 只新增差集、删除差集，避免重复插入关联行
    const toAdd = roles.filter(role => !currentIds.has(role.id))
    const toRemove = current.filter(role => !nextIds.has(role.id))
    await this.repository.createQueryBuilder().relation(UserEntity, 'roles').of(id).addAndRemove(toAdd, toRemove)
  }

  /**
   * 绑定部门（全量覆盖，对齐 JeecgBoot sys_user_depart）
   * - 入参顺序即主次顺序，第一个为主部门
   * - 同步冗余：sys_user.depart_ids（逗号串）、sys_user.org_code（主部门机构编码）
   */
  async assignDepts(id: string, deptIds: string[]): Promise<void> {
    await this.findOne(id)
    const ids = [...new Set(deptIds.filter(Boolean))]
    const depts = ids.length ? await this.deptRepository.find({ where: { id: In(ids), delFlag: '0' } }) : []
    if (depts.length !== ids.length) {
      const found = new Set(depts.map(dept => dept.id))
      throw new BusinessException(`部门不存在或已删除：${ids.filter(depId => !found.has(depId)).join(',')}`, 400)
    }
    const deptMap = new Map(depts.map(dept => [dept.id, dept]))
    const ordered = ids.map(depId => deptMap.get(depId) as DeptEntity)

    const current = await this.repository.createQueryBuilder().relation(UserEntity, 'depts').of(id).loadMany<DeptEntity>()
    const currentIds = new Set(current.map(dept => dept.id))
    const toAdd = ordered.filter(dept => !currentIds.has(dept.id))
    const toRemove = current.filter(dept => !ids.includes(dept.id))
    if (toAdd.length || toRemove.length) {
      await this.repository.createQueryBuilder().relation(UserEntity, 'depts').of(id).addAndRemove(toAdd, toRemove)
    }

    await this.repository.update(id, {
      departIds: ids.length ? ids.join(',') : null,
      orgCode: ordered[0]?.orgCode ?? null
    })
  }

  /** 分页列表：支持 keyword 模糊搜索账号/真实姓名/电话、status 精确过滤、部门过滤；过滤已软删 */
  async listByQuery(query: QueryUserDto): Promise<Pagination<UserEntity>> {
    const qb = this.repository.createQueryBuilder('user').where('user.del_flag = 0').orderBy('user.create_time', 'DESC')

    if (query.keyword) {
      qb.andWhere('(user.username LIKE :keyword OR user.realname LIKE :keyword OR user.phone LIKE :keyword)', {
        keyword: `%${query.keyword}%`
      })
    }
    if (query.status !== undefined && query.status !== '') {
      qb.andWhere('user.status = :status', { status: Number(query.status) })
    }
    // 部门过滤：命中 sys_user_depart 任一部门即返回（deptId 与 deptIds 取并集）
    const deptFilters = [
      ...(query.deptId ? [query.deptId] : []),
      ...(query.deptIds ? query.deptIds.split(',').map(value => value.trim()).filter(Boolean) : [])
    ]
    if (deptFilters.length) {
      qb.andWhere('EXISTS (SELECT 1 FROM `sys_user_depart` ud WHERE ud.`user_id` = user.id AND ud.`dep_id` IN (:...deptFilters))', {
        deptFilters
      })
    }

    const options: PaginateOptions = { page: query.page, pageSize: query.pageSize }
    const result = await paginate(qb, options)
    await this.attachDepts(result.items)
    return result
  }

  /** 单查覆盖：过滤已软删用户 */
  async findOne(id: string): Promise<UserEntity> {
    const user = await this.repository.findOne({ where: { id, delFlag: 0 } })
    if (!user) {
      throw new NotFoundException('用户不存在')
    }
    return user
  }

  /** 按 id 查找并带出角色（过滤已软删） */
  async findOneWithRoles(id: string): Promise<UserEntity | null> {
    const user = await this.repository.findOne({ where: { id, delFlag: 0 }, relations: { roles: true, depts: true } })
    if (user) {
      this.applyDepts(user)
    }
    return user
  }

  /** 详情：带出角色 + 部门（过滤已软删，不存在抛 404） */
  async findOneDetail(id: string): Promise<UserEntity> {
    const user = await this.repository.findOne({ where: { id, delFlag: 0 }, relations: { roles: true, depts: true } })
    if (!user) {
      throw new NotFoundException('用户不存在')
    }
    this.applyDepts(user)
    return user
  }

  /** 按 id 查找（含密码与盐，仅供认证场景使用；过滤已软删） */
  async findOneWithPassword(id: string): Promise<UserEntity | null> {
    return this.repository
      .createQueryBuilder('user')
      .addSelect(['user.password', 'user.salt'])
      .where('user.id = :id', { id })
      .andWhere('user.del_flag = 0')
      .getOne()
  }

  /** 按用户名查找并带出角色、部门（登录用，密码与盐显式加查；过滤已软删） */
  async findByUsername(username: string): Promise<UserEntity | null> {
    const user = await this.repository
      .createQueryBuilder('user')
      .addSelect(['user.password', 'user.salt'])
      .leftJoinAndSelect('user.roles', 'role')
      .leftJoinAndSelect('user.depts', 'dept')
      .where('user.username = :username', { username })
      .andWhere('user.del_flag = 0')
      .getOne()
    if (user) {
      this.applyDepts(user)
    }
    return user
  }

  /** 软删除（对齐 sys_user.del_flag）：置 del_flag=1 而非物理删除；admin 不可删除 */
  async delete(id: string): Promise<void> {
    const user = await this.findOne(id)
    if (user.username === 'admin') {
      throw new BusinessException('内置管理员账号不允许删除', 400)
    }
    await this.repository.update(id, { delFlag: 1 })
  }

  /** 校验登录密码：JeecgBoot 算法 PBEWithMD5AndDES(username, password, salt) */
  verifyPassword(user: UserEntity, plainPassword: string): boolean {
    if (!user.password || !user.salt) {
      return false
    }
    return encryptPassword(user.username, plainPassword, user.salt) === user.password
  }

  /** 去掉密码与盐字段，安全返回 */
  stripPassword(user: UserEntity): Omit<UserEntity, 'password' | 'salt'> {
    const { password: _password, salt: _salt, ...rest } = user
    void _password
    void _salt
    return rest
  }

  /**
   * 去掉不允许客户端直接写入的字段
   * - depts / dept：关系字段与组装字段，非数据库列
   * - depart_ids / org_code：由 assignDepts 按主部门统一维护，避免两处写法互相覆盖
   */
  private stripUnwritableFields(data: Partial<UserEntity>): void {
    delete data.depts
    delete data.dept
    delete data.departIds
    delete data.orgCode
  }

  /** 按 depart_ids 顺序整理部门，并把 depts[0] 同步到兼容字段 dept */
  private applyDepts(user: UserEntity): void {
    user.depts = this.orderDepts(user.depts ?? [], user.departIds)
    user.dept = user.depts[0] ?? null
  }

  /** 批量补部门（列表页一次查关联表，避免 N+1） */
  private async attachDepts(users: UserEntity[]): Promise<void> {
    if (!users.length) {
      return
    }
    const rows = await this.repository.find({
      where: { id: In(users.map(user => user.id)) },
      relations: { depts: true }
    })
    const deptMap = new Map(rows.map(row => [row.id, this.orderDepts(row.depts ?? [], row.departIds)]))
    for (const user of users) {
      user.depts = deptMap.get(user.id) ?? []
      user.dept = user.depts[0] ?? null
    }
  }

  /** 按 depart_ids 的先后排序（未登记的排最后） */
  private orderDepts(depts: DeptEntity[], departIds?: string | null): DeptEntity[] {
    if (!departIds) {
      return depts
    }
    const rank = new Map(departIds.split(',').filter(Boolean).map((depId, index) => [depId, index]))
    const last = Number.MAX_SAFE_INTEGER
    return [...depts].sort((a, b) => (rank.get(a.id) ?? last) - (rank.get(b.id) ?? last))
  }
}
```

### 3.5 `src/modules/user/user.controller.ts`

```ts
import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Roles } from '../../common/decorators/roles.decorator'
import { Perms } from '../../common/decorators/perms.decorator'
import { OperLog } from '../../common/decorators/oper-log.decorator'
import { CreateUserDto } from './dto/create-user.dto'
import { QueryUserDto } from './dto/query-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { UserEntity } from './entities/user.entity'
import { UserService } from './user.service'

@ApiTags('用户管理')
@ApiBearerAuth('jwt')
@Roles('admin')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @ApiOperation({ summary: '分页查询用户列表', description: '支持 keyword 模糊匹配账号/真实姓名/电话、status 精确过滤' })
  @ApiOkResponse({ description: '分页结果', type: [UserEntity] })
  @Get()
  list(@Query() query: QueryUserDto) {
    return this.userService.listByQuery(query)
  }

  @ApiOperation({ summary: '查询用户详情（含角色与部门）' })
  @ApiOkResponse({ description: '用户信息', type: UserEntity })
  @Get(':id')
  findOne(@Param('id') id: string): Promise<UserEntity> {
    return this.userService.findOneDetail(id)
  }

  @ApiOperation({ summary: '创建用户', description: '32位主键自动生成；密码按 JeecgBoot PBEWithMD5AndDES(username, password, salt) 入库' })
  @OperLog('用户管理')
  @Perms('system:user:add')
  @Post()
  async create(@Body() dto: CreateUserDto, @Request() req: { user: { username: string } }) {
    const user = await this.userService.create(dto, req.user.username)
    return this.userService.stripPassword(user)
  }

  @ApiOperation({ summary: '更新用户', description: 'username 不可修改（密码算法绑定账号）；改密码自动换新盐' })
  @OperLog('用户管理')
  @Perms('system:user:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Request() req: { user: { username: string } }) {
    return this.userService.update(id, dto, req.user.username)
  }

  @ApiOperation({ summary: '删除用户（软删除）' })
  @OperLog('用户管理')
  @Perms('system:user:delete')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.userService.delete(id)
  }

  @ApiOperation({ summary: '为用户绑定角色（全量覆盖）' })
  @Put(':id/roles')
  async assignRoles(@Param('id') id: string, @Body() dto: { roleIds: string[] }) {
    await this.userService.assignRoles(id, dto.roleIds)
    return this.userService.findOneWithRoles(id)
  }

  @ApiOperation({
    summary: '为用户绑定部门（全量覆盖）',
    description: '写入 sys_user_depart；数组顺序即主次，第一个为主部门，同步 depart_ids 与 org_code'
  })
  @OperLog('用户管理')
  @Put(':id/depts')
  async assignDepts(@Param('id') id: string, @Body() dto: { deptIds: string[] }) {
    await this.userService.assignDepts(id, dto.deptIds ?? [])
    return this.userService.findOneDetail(id)
  }
}
```

### 3.6 `src/modules/user/user.module.ts`

```ts
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { RoleModule } from '../role/role.module'
import { DeptEntity } from '../system/dept/entities/dept.entity'
import { UserEntity } from './entities/user.entity'
import { UserController } from './user.controller'
import { UserService } from './user.service'

@Module({
  // DeptEntity 需在本模块 forFeature 注册，才能在此注入 Repository（跨模块注入不生效）
  imports: [TypeOrmModule.forFeature([UserEntity, DeptEntity]), RoleModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService]
})
export class UserModule {}
```

### 3.7 `src/modules/user/dto/create-user.dto.ts`

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsDateString, IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator'

export class CreateUserDto {
  @ApiProperty({ description: '登录账号（唯一，3~100 位；密码算法绑定账号，创建后不可改）', example: 'zhangsan', minLength: 3, maxLength: 100 })
  @IsString()
  @Length(3, 100, { message: '用户名长度须在 3~100 位之间' })
  username: string

  @ApiProperty({ description: '真实姓名', example: '张三', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  realname?: string

  @ApiProperty({ description: '密码（6~64 位明文，服务端生成盐并按 JeecgBoot 算法加密入库）', example: '123456', minLength: 6, maxLength: 64 })
  @IsString()
  @Length(6, 64, { message: '密码长度须在 6~64 位之间' })
  password: string

  @ApiPropertyOptional({ description: '头像 URL（可通过 /api/upload 上传获得）', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  avatar?: string

  @ApiPropertyOptional({ description: '性别：0 未知 / 1 男 / 2 女', example: 1, enum: [0, 1, 2] })
  @IsOptional()
  @IsIn([0, 1, 2])
  @Type(() => Number)
  sex?: number

  @ApiPropertyOptional({ description: '电话', example: '18611111111', maxLength: 45 })
  @IsOptional()
  @IsString()
  @MaxLength(45)
  phone?: string

  @ApiPropertyOptional({ description: '座机号', example: '010-88886666', maxLength: 45 })
  @IsOptional()
  @IsString()
  @MaxLength(45)
  telephone?: string

  @ApiPropertyOptional({ description: '邮箱', example: 'zhangsan@test.com', maxLength: 45 })
  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string

  @ApiPropertyOptional({ description: '生日（YYYY-MM-DD）', example: '1990-01-01' })
  @IsOptional()
  @IsDateString({}, { message: '生日须为合法日期（YYYY-MM-DD）' })
  birthday?: string

  @ApiPropertyOptional({ description: '工号（唯一）', example: '00003', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  workNo?: string

  @ApiPropertyOptional({ description: '状态：1 正常 / 2 冻结', example: 1, enum: [1, 2] })
  @IsOptional()
  @IsIn([1, 2])
  status?: number

  @ApiPropertyOptional({ description: '角色 ID 列表（sys_role.id，32 位字符串）', example: ['f6817f48af4fb3af11b9e8bf182f618b'], type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  roleIds?: string[]

  @ApiPropertyOptional({
    description: '所属部门 ID 列表（sys_depart.id，按顺序写入 sys_user_depart，第一个为主部门），传空数组表示清空',
    example: ['dept_1', 'dept_2'],
    type: [String]
  })
  @IsOptional()
  @IsArray({ message: 'deptIds 必须是数组' })
  @IsString({ each: true, message: 'deptIds 元素必须是字符串' })
  deptIds?: string[]

  @ApiPropertyOptional({ description: '【已废弃，请用 deptIds】单个部门 ID，等价于 deptIds: [deptId]', example: 'dept_1', deprecated: true })
  @IsOptional()
  @IsString()
  deptId?: string
}
```

### 3.8 `src/modules/user/dto/query-user.dto.ts`

```ts
import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength } from 'class-validator'

import { PagerDto } from '../../../common/dto/pager.dto'

/** 用户列表查询参数 */
export class QueryUserDto extends PagerDto {
  @ApiPropertyOptional({ description: '关键字：模糊匹配用户名/真实姓名/手机号', example: '张' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  keyword?: string

  @ApiPropertyOptional({ description: '状态过滤：1 正常 / 2 冻结', example: '1', enum: ['1', '2'] })
  @IsOptional()
  @IsString()
  status?: string

  @ApiPropertyOptional({ description: '部门 ID 过滤（单个，sys_depart.id，命中用户的任一部门即返回）', example: 'dept_1' })
  @IsOptional()
  @IsString()
  deptId?: string

  @ApiPropertyOptional({ description: '部门 ID 过滤（多个，英文逗号分隔；与 deptId 同时传取并集）', example: 'dept_1,dept_2' })
  @IsOptional()
  @IsString()
  deptIds?: string
}
```

### 3.9 `src/modules/system/dept/dept.service.ts`（仅 update / delete 两段改动，其余不变）

```ts
  /** 更新：父级不能指向自己或自己的后代（防环）；改父级时同步重算 orgCode */
  async update(id: string, dto: DeepPartial<DeptEntity>): Promise<DeptEntity> {
    const before = await this.findOne(id)
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
    const updated = await super.update(id, dto)
    // 机构编码变了，把挂了该部门的用户 sys_user.org_code 一并刷新（上面存的是冗余值）
    if (updated.orgCode && updated.orgCode !== before.orgCode) {
      await this.repository.manager.query(
        'UPDATE `sys_user` u JOIN `sys_user_depart` ud ON ud.`user_id` = u.`id` SET u.`org_code` = ? WHERE ud.`dep_id` = ?',
        [updated.orgCode, id]
      )
    }
    return updated
  }

  /** 删除：有下级或挂了（未删除的）用户时不允许删（软删，置 del_flag='1'） */
  async delete(id: string): Promise<void> {
    await this.findOne(id)
    const childCount = await this.repository.count({ where: { parentId: id, delFlag: '0' } })
    if (childCount > 0) {
      throw new BadRequestException('该部门下存在子部门，无法删除')
    }
    // 走 sys_user_depart 关联表统计，并排除已软删用户（否则删过的人会一直挡住部门删除）
    const userCount = await this.repository.manager
      .createQueryBuilder(UserEntity, 'user')
      .innerJoin('user.depts', 'dept', 'dept.id = :deptId', { deptId: id })
      .where('user.del_flag = 0')
      .getCount()
    if (userCount > 0) {
      throw new BadRequestException('该部门下存在用户，无法删除')
    }
    await this.repository.update(id, { delFlag: '1' })
  }
```

## 四、遇到的坑

1. **`@Column({ length: ... })` + `string | null` 会被推断成 Object**
   迁移报 `Data type "Object" in "UserEntity.orgCode" is not supported by "mysql"`。
   原因：`design:type` 元数据对联合类型只能拿到 `Object`。给 `orgCode` / `departIds` 显式写 `type: 'varchar'` 即解决。

2. **TypeORM 多对多插入关联行不会写主键**
   JeecgBoot 的 `sys_user_depart` 主键是独立的 `ID varchar(32)`，TypeORM 只会 `INSERT (user_id, dep_id)`。
   必须给 `ID` 加 DB 默认值 `DEFAULT (replace(uuid(),'-',''))`（`sys_user_role` 早就是这么处理的），否则报 `Field 'ID' doesn't have a default value`。

3. **MySQL 8 的表达式默认值**
   `DEFAULT (uuid())` 生成的是 36 位带横线的串，超过 `varchar(32)` → 用 `replace(uuid(),'-','')`；
   表达式默认值必须用括号包起来。

4. **部门反向关系少一个 `../`**
   最初写成 `../../user/entities/user.entity`，TS 直接找不到模块（dept.entity 在 `modules/system/dept/entities`，要退三级）。

5. **多对多 + 分页同时 join 容易踩 `distinctAlias` 坑**
   列表页没有用 `leftJoinAndSelect('user.depts')`，而是先 `paginate` 再 `attachDepts` 一次性批量补数据：
   既避开 TypeORM 分页 + 集合 join 的排序问题，也避免 N+1。

6. **软删用户挡住部门删除（顺带修掉的老 bug）**
   原逻辑 `count({ where: { deptId: id } })` 把 `del_flag=1` 的用户也算进去。
   实测 `dept_2` 只剩一个已删用户 `tester`，部门却删不掉；改成 join 关联表 + `del_flag=0` 后正常。

7. **`dept` 兼容字段不是数据库列**
   若把它写成 `@ManyToOne` 就会重新生成 `dept_id` 列，等于走回头路。
   现在是纯 class 属性，只在 Service 里赋值 `depts[0]`，`stripUnwritableFields` 还会把它从客户端入参里删掉。

8. **`depart_ids` / `org_code` 必须单一写入点**
   如果 `update` 允许客户端直接传这两个字段，就会和 `assignDepts` 的写回互相覆盖。统一在 `stripUnwritableFields` 里剔除。

## 五、怎么用 / 怎么扩展

### 5.1 接口示例

创建用户（多部门，`dept_2` 为主部门）：

```bash
curl -X POST http://127.0.0.1:3459/api/users \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"username":"test_multi","realname":"多部门测试","password":"123456","deptIds":["dept_2","dept_4"]}'
# → orgCode: "A01A01"（dept_2 的机构编码）, departIds: "dept_2,dept_4",
#   depts: [研发部(dept_2), 研发部(dept_4)], dept: 研发部(dept_2)
```

重绑部门：

```bash
curl -X PUT http://127.0.0.1:3459/api/users/<id>/depts \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"deptIds":["dept_5"]}'
# → orgCode: "A01A03", departIds: "dept_5"
```

清空部门：`{"deptIds": []}` → `orgCode: null`、`departIds: null`、`depts: []`。

列表过滤：

```bash
GET /api/users?deptId=dept_2          # 单部门
GET /api/users?deptIds=dept_2,dept_5  # 多部门（并集）
```

### 5.2 前端接法建议

- 用户表单用部门多选（树），提交 `deptIds` 数组；把用户勾选顺序当作主次顺序，第一个为主部门。
- 列表展示用 `depts`（或多部门拼接 `depts.map(d => d.departName).join('、')`）；老代码读 `dept` 也不用改。
- 数据权限（自己/本部门/本机构）：直接比 `user.orgCode` 前缀，例如 `orgCode LIKE 'A01%'` 即本机构及下级。

### 5.3 后续可扩展点

1. **按部门树递归过滤**：现在 `deptId` 是精确匹配。要做「选中部门含下级」时，先取出子树 id 列表再拼 `deptIds`。
2. **主部门专用字段**：若产品要求「主部门」可独立于顺序设置，可加 `sys_user_depart.is_primary`（需要同步迁移与 `assignDepts`）。
3. **`depart_ids` 一致性巡检**：加一条定时 SQL 对比 `sys_user_depart` 与 `depart_ids`，防止外部直接改库造成漂移。
4. **历史脏数据**：`sys_user.org_code` 里有历史测试写入的中文值（如 `财务部`），可在数据治理时统一用
   `UPDATE sys_user u JOIN sys_user_depart ud ... SET u.org_code = d.org_code` 重刷一遍。

## 六、验证记录（2026-11-04 实测）

| 场景 | 结果 |
| --- | --- |
| 迁移执行 | `Migration1793767900000` 成功；`dept_id` 已删除，`admin → dept_1`、`tester → dept_2` 搬入关联表，`depart_ids`/`org_code` 回填正确 |
| 登录 admin/123456 | 成功，`userInfo` 新增 `depts`/`dept`/`departIds`/`orgCode` |
| `GET /api/users?page=1&pageSize=3` | `items[].depts` 正确、`dept` = 主部门、无 N+1 |
| 创建 `deptIds: ["dept_2","dept_4"]` | `orgCode=A01A01`、`departIds=dept_2,dept_4`、顺序与入参一致 |
| `GET /users?deptId=dept_4` | 命中新用户（total 1） |
| `GET /users?deptIds=dept_5,dept_1` | 命中 admin（并集过滤生效） |
| `PUT /users/:id/depts {"deptIds":["dept_5"]}` | `orgCode=A01A03`、`departIds=dept_5`，旧关联被清掉 |
| `PUT /users/:id/depts {"deptIds":[]}` | `orgCode=null`、`departIds=null`、`depts=[]` |
| 非法部门 id | `{"code":400,"message":"部门不存在或已删除：nope"}` |
| `DELETE /api/depts/dept_1` | `code 400 该部门下存在子部门，无法删除` |
| `DELETE /api/depts/dept_2`（仅软删用户） | 成功（修复前的误判已解决） |
| 工程检查 | `tsc --noEmit`、`eslint`、`oxlint` 全通过（4 条历史 `no-misused-spread` 警告与本轮无关） |
