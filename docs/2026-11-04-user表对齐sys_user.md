# 2026-11-04 user 表对齐 JeecgBoot sys_user

> 背景：以 `E:\demo\JeecgBoot-main\...\db\jeecgboot-mysql-5.7.sql` 中的 `sys_user` 为参照，把本项目登录用户表 `user` 的表注释、字段、种子数据对齐，代码同步更新。后续 role/menu/dept 等表将按同样方式逐张对齐。

## 一、表对应关系

| 本项目 | JeecgBoot | 说明 |
| --- | --- | --- |
| `user` | `sys_user` | 用户表（本轮对齐） |
| `role` | `sys_role` | 角色表（后续） |
| `menu` | `sys_permission` | 菜单权限表（后续） |
| `dept` | `sys_depart` | 部门表（后续） |
| `dict_type` / `dict_item` | `sys_dict` / `sys_dict_item` | 字典（后续） |
| `notice` | `sys_announcement` | 公告（后续） |

## 二、字段对齐明细

| 本项目字段 | sys_user 字段 | 动作 |
| --- | --- | --- |
| `nickname` varchar(32) | `realname` varchar(100) | **改名**：昵称 → 真实姓名，数据保留 |
| - | `avatar` varchar(255) | 新增：头像 |
| - | `sex` tinyint | 新增：性别(0-未知,1-男,2-女) |
| - | `phone` varchar(45) | 新增：手机号 |
| - | `telephone` varchar(45) | 新增：座机号 |
| `email` varchar(64) | `email` | 已有，注释统一为「电子邮件」 |
| - | `birthday` date | 新增：生日 |
| - | `work_no` varchar(100) | 新增：工号，唯一索引 |
| - | `create_by` varchar(32) | 新增：创建人 |
| - | `update_by` varchar(32) | 新增：更新人 |
| - | `del_flag` tinyint | 新增：删除状态(0-正常,1-已删除)，**软删除** |
| `password` varchar(128) | `password` + `salt` | 不加 salt——本项目用 bcrypt（盐内嵌哈希串），JeecgBoot 用 md5+salt 才需要 |
| 表注释 | `COMMENT='用户表'` | `user` 表补注释「用户表（对齐 JeecgBoot sys_user）」 |

> 有意不抄的字段：`salt`（bcrypt 不需要）、`org_code`/`tenant_id`/`third_*`（多租户/三方登录，未做）、`client_id`/`bpm_status`（工作流，未做）。

## 三、种子数据更新（按 sys_user 风格）

- `admin`：realname=管理员、sex=1、work_no=00001（对应 JeecgBoot sys_user 里 admin 的初始数据风格）
- 其余用户（guest/auditor1）：realname 保留原昵称数据，工号按 `LPAD(id+1, 5, '0')` 顺延

## 四、改动文件与完整代码

### 1. 新增迁移 `src/migrations/1793763842271-Migration.ts`

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * user 表对齐 JeecgBoot sys_user：
 * 1. 补表注释「用户表」
 * 2. nickname → realname（真实姓名，与 sys_user 对齐）
 * 3. 新增 avatar/sex/phone/telephone/birthday/work_no/create_by/update_by/del_flag
 * 4. 种子数据按 sys_user 风格补齐（admin：管理员/工号00001/男）
 */
export class Migration1793763842271 implements MigrationInterface {
  name = 'Migration1793763842271'

  async up(queryRunner: QueryRunner): Promise<void> {
    // 表注释
    await queryRunner.query("ALTER TABLE `user` COMMENT='用户表（对齐 JeecgBoot sys_user）'")

    // nickname → realname，同步保留原数据
    await queryRunner.query("ALTER TABLE `user` CHANGE COLUMN `nickname` `realname` varchar(100) NOT NULL COMMENT '真实姓名'")

    // 新增字段（对齐 sys_user）
    await queryRunner.query("ALTER TABLE `user` ADD COLUMN `avatar` varchar(255) NULL COMMENT '头像' AFTER `realname`")
    await queryRunner.query("ALTER TABLE `user` ADD COLUMN `sex` tinyint NOT NULL DEFAULT 0 COMMENT '性别(0-默认未知,1-男,2-女)' AFTER `avatar`")
    await queryRunner.query("ALTER TABLE `user` ADD COLUMN `phone` varchar(45) NULL COMMENT '手机号' AFTER `sex`")
    await queryRunner.query("ALTER TABLE `user` ADD COLUMN `telephone` varchar(45) NULL COMMENT '座机号' AFTER `phone`")
    await queryRunner.query("ALTER TABLE `user` ADD COLUMN `birthday` date NULL COMMENT '生日' AFTER `email`")
    await queryRunner.query("ALTER TABLE `user` ADD COLUMN `work_no` varchar(100) NULL COMMENT '工号，唯一' AFTER `birthday`")
    await queryRunner.query("ALTER TABLE `user` ADD COLUMN `create_by` varchar(32) NULL COMMENT '创建人'")
    await queryRunner.query("ALTER TABLE `user` ADD COLUMN `update_by` varchar(32) NULL COMMENT '更新人'")
    await queryRunner.query("ALTER TABLE `user` ADD COLUMN `del_flag` tinyint NOT NULL DEFAULT 0 COMMENT '删除状态(0-正常,1-已删除)'")
    await queryRunner.query('ALTER TABLE `user` ADD UNIQUE INDEX `uniq_user_work_no` (`work_no`)')

    // 种子数据按 sys_user 风格更新：admin → 管理员/男/工号00001
    await queryRunner.query(
      "UPDATE `user` SET `realname`='管理员', `sex`=1, `work_no`='00001' WHERE `username`='admin'"
    )
    // 其余用户按现有 realname（原昵称）保留，工号顺延
    await queryRunner.query(
      "UPDATE `user` SET `work_no`=LPAD(CAST(`id` + 1 AS CHAR), 5, '0') WHERE `work_no` IS NULL"
    )
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `user` DROP INDEX `uniq_user_work_no`')
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `del_flag`')
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `update_by`')
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `create_by`')
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `work_no`')
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `birthday`')
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `telephone`')
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `phone`')
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `sex`')
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `avatar`')
    await queryRunner.query("ALTER TABLE `user` CHANGE COLUMN `realname` `nickname` varchar(32) NOT NULL COMMENT '昵称'")
    await queryRunner.query("ALTER TABLE `user` COMMENT=''")
  }
}
```

### 2. 重写实体 `src/modules/user/entities/user.entity.ts`

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, CreateDateColumn, Entity, JoinColumn, JoinTable, ManyToMany, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import { RoleEntity } from '../../role/entities/role.entity'
import { DeptEntity } from '../../system/dept/entities/dept.entity'

/** 用户表（表结构对齐 JeecgBoot sys_user） */
@Entity('user')
export class UserEntity {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ length: 32, unique: true, comment: '登录账号' })
  username: string

  @Column({ length: 100, comment: '真实姓名' })
  realname: string

  /** select: false —— 默认查询不带出密码 */
  @Column({ length: 128, select: false, comment: '密码（bcrypt 加密后）' })
  password: string

  @Column({ length: 255, nullable: true, comment: '头像' })
  avatar?: string

  @Column({ type: 'tinyint', default: 0, comment: '性别(0-默认未知,1-男,2-女)' })
  sex: number

  @Column({ length: 45, nullable: true, comment: '手机号' })
  phone?: string

  @Column({ length: 45, nullable: true, comment: '座机号' })
  telephone?: string

  @Column({ length: 64, nullable: true, comment: '电子邮件' })
  email?: string

  @Column({ type: 'date', nullable: true, comment: '生日' })
  birthday?: string

  @Column({ name: 'work_no', length: 100, nullable: true, unique: true, comment: '工号，唯一' })
  workNo?: string

  @Column({ type: 'tinyint', default: 1, comment: '状态：0禁用 1启用' })
  status: number

  @Column({ name: 'del_flag', type: 'tinyint', default: 0, comment: '删除状态(0-正常,1-已删除)' })
  delFlag: number

  @Column({ name: 'create_by', length: 32, nullable: true, comment: '创建人' })
  createBy?: string

  @Column({ name: 'update_by', length: 32, nullable: true, comment: '更新人' })
  updateBy?: string

  @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', comment: '更新时间' })
  updatedAt: Date

  @ManyToMany(() => RoleEntity, role => role.users)
  @JoinTable({ name: 'user_roles' })
  roles: RoleEntity[]

  @Column({ type: 'int', default: 0, comment: '所属部门ID，0为未分配' })
  deptId: number

  @ManyToOne(() => DeptEntity, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'deptId' })
  dept?: DeptEntity | null
}
```

（完整版含所有 @ApiProperty/@ApiPropertyOptional Swagger 注解，见源文件。）

### 3. Create DTO `src/modules/user/dto/create-user.dto.ts`

`nickname` → `realname`（必填，1~100 位）；新增可选 `avatar`（≤255）、`sex`（0/1/2）、`phone`/`telephone`（≤45）、`email`（加 64 上限）、`birthday`（`@IsDateString`）、`workNo`（≤100，唯一）；校验规则与源文件一致。`UpdateUserDto` 走 `PartialType` 自动继承。

### 4. Service `src/modules/user/user.service.ts` 关键改动

```ts
/** 创建：密码自动 bcrypt 哈希后入库；支持 roleIds 直接绑角色；operator 为创建人 */
async create(dto: Partial<UserEntity> & { roleIds?: number[] }, operator?: string): Promise<UserEntity> {
  const data: Partial<UserEntity> = { ...dto }
  delete (data as { roleIds?: number[] }).roleIds
  if (operator) {
    data.createBy = operator
    data.updateBy = operator
  }
  if (data.password) {
    data.password = await bcrypt.hash(data.password, 10)
  }
  const user = await super.create(data)
  if (dto.roleIds?.length) {
    await this.assignRoles(user.id, dto.roleIds)
  }
  return this.findOneDetail(user.id) as Promise<UserEntity>
}

/** 软删除（对齐 sys_user.del_flag）：置 delFlag=1 而非物理删除；admin 不可删除 */
async delete(id: number): Promise<void> {
  const user = await this.findOne(id)
  if (user.username === 'admin') {
    throw new BusinessException('内置管理员账号不允许删除', 400)
  }
  await this.repository.update(id, { delFlag: 1 })
}

/** 单查覆盖：过滤已软删用户 */
async findOne(id: number): Promise<UserEntity> {
  const user = await this.repository.findOne({ where: { id, delFlag: 0 } })
  if (!user) {
    throw new NotFoundException('用户不存在')
  }
  return user
}
```

其余改动：
- `update(id, dto, operator?)`：operator 记入 `updateBy`
- `listByQuery`：`where('user.delFlag = 0')` + keyword 同时模糊匹配 `username/realname/phone`
- `findOneWithRoles/findOneDetail/findOneWithPassword/findByUsername` 全部加 `delFlag = 0` 过滤（登录/认证链路也查不到已删用户）
- `findOneDetail` 查不到时抛 404（原来返回 null 被包装成 data:null）

### 5. Controller `src/modules/user/user.controller.ts`

create/update 通过 `@Request() req` 取 `req.user.username` 作为操作人传给 service；导入 `Request`。

### 6. Query DTO `src/modules/user/dto/query-user.dto.ts`

keyword 描述更新为「模糊匹配用户名/真实姓名/手机号」。

## 五、遇到的坑（重点学习）

1. **项目并没有全局 snake_case 命名策略**——TypeORM 实体 `workNo` 默认映射列名就是 `workNo`（而不是 `work_no`）。之前「TypeORM 1.x 默认 snake_case」的经验来自 `created_at` 恰好显式声明过。结论：**多词属性要么显式 `@Column({ name: 'xxx_yyy' })`，要么迁移列名用驼峰**，二选一必须对齐，否则运行时 `Unknown column 'user.workNo'`（本次登录直接 500 才暴露）。
2. **多词列名踩了三次**：`workNo` → 加 `name: 'work_no'`；`delFlag` → `name: 'del_flag'`；`createBy/updateBy` → `name: 'create_by'/'update_by'`。单字段修复后要全量排查同类，别挤牙膏。
3. **迁移里 AFTER 引用不存在的列会直接报错**——初版在 `create_by` 行留了个 `AFTER del_flag_placeholder` 占位，写完必须自查每条 SQL 的列引用。
4. **软删除要覆盖所有查询口**：列表、详情、按用户名（登录）、按 id（认证校验）共 5 个查询方法都要加 `delFlag = 0`，漏一个就会出现「已删用户仍能登录」。
5. **业务错误别用 `throw new Error`**——会被全局过滤器按 500 处理，要用 `BusinessException(msg, code)` 返回 HTTP 200 + 业务码（本项目约定）。

## 六、验证记录

- 迁移执行成功；直查 DB 确认表注释、admin（管理员/男/00001）、guest（00003）、auditor1（00004）数据正确
- 冒烟：登录（Redis 验证码链路）→ 创建 wangwu（sex/phone/workNo/birthday 全落库，createBy=admin）→ 更新（updateBy=admin）→ 删除（软删）→ 详情 404 → 列表不含已删 → profile 返回 realname/sex/workNo → 删 admin 返回 400 业务错误 ✅
- build / eslint / oxlint 通过

## 七、怎么扩展

- **下一张表**：role → sys_role、menu → sys_permission、dept → sys_depart、dict → sys_dict/sys_dict_item，套路相同：对字段 → 迁移（含数据回填）→ 实体显式列名 → DTO/Service
- **新用户字段**：在实体加属性时，多词属性必须写 `@Column({ name: 'snake_name', ... })`，迁移同步建列
- **前端适配**：接口里 `nickname` 已改名 `realname`，列表/详情/profile 响应结构多了 avatar/sex/phone/workNo 等字段
