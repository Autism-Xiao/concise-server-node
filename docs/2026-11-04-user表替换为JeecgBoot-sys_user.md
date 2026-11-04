# 2026-11-04 user 表替换为 JeecgBoot sys_user + 全局 snake_case 命名策略

> 按用户要求三步走：① 删除旧 `user` 表，以 JeecgBoot `sys_user` 表结构与初始数据为主重建；② 登录等代码全面适配新表（字符串主键、JeecgBoot 密码算法）；③ 全局启用 snake_case 命名策略。

## 一、登录密码算法（本次最核心的破译）

JeecgBoot `sys_user.password` 是 16 位 hex，来自 `PasswordUtil.encrypt(username, password, salt)`（PBEWithMD5AndDES，可逆加密）：

```
1. 密钥派生（RFC 2898 PBKDF1，MD5，迭代 1000 次）：
   T₁ = MD5(password 的 UTF-8 字节 || salt 的 ASCII 字节)
   Tᵢ = MD5(Tᵢ₋₁)  ← 共迭代 1000 次
   前 8 字节 = DES 密钥，后 8 字节 = IV
2. 密文 = DES-CBC(key, iv, username 的 UTF-8 字节, PKCS5 填充)
3. 输出 = 8 字节密文的十六进制（16 位）
```

**验证**：admin/123456 + salt RCGTeGiH → `cb362cfeefbf3d8d` ✓、jeecg/123456 → `eee378a1258530cb` ✓、ceshi/123456 → `a9932bb12d2cbc5a` ✓，三条与 JeecgBoot 初始数据逐位一致。

**测试账号即 JeecgBoot 默认：admin / 123456**（还有 ceshi/zhangsan/jeecg，密码都是 123456）。

### 新增 `src/utils/password.util.ts`

```ts
import { createHash, randomBytes } from 'crypto'
import { DES, mode, pad, enc, lib } from 'crypto-js'

const ITERATION_COUNT = 1000

/** JeecgBoot 兼容加密：返回 16 位十六进制密码串 */
export function encryptPassword(username: string, password: string, salt: string): string {
  const derived = deriveKeyIV(password, salt)
  const key = lib.WordArray.create(derived.key)
  const iv = lib.WordArray.create(derived.iv)
  const encrypted = DES.encrypt(enc.Utf8.parse(username), key, {
    iv, mode: mode.CBC, padding: pad.Pkcs7
  })
  return encrypted.ciphertext.toString(enc.Hex)
}

/** PBKDF1-MD5：MD5(password || salt) 迭代 1000 次，前 8 字节 key、后 8 字节 IV */
function deriveKeyIV(password: string, salt: string): { key: Uint8Array; iv: Uint8Array } {
  let digest = createHash('md5').update(Buffer.concat([Buffer.from(password, 'utf8'), Buffer.from(salt, 'ascii')])).digest()
  for (let i = 1; i < ITERATION_COUNT; i++) {
    digest = createHash('md5').update(digest).digest()
  }
  return { key: digest.subarray(0, 8), iv: digest.subarray(8, 16) }
}

export function randomSalt(): string {
  return randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).padEnd(8, '0')
}

export function randomId32(): string {
  return randomBytes(16).toString('hex')
}
```

学习点：
- **Node 的 OpenSSL 3 已禁用 DES**（`error:0308010C unsupported`），原生 crypto 用不了 DES-CBC，必须借助 crypto-js（其 DES 是纯 JS 实现）。PBKDF1 派生部分仍用原生 `crypto.createHash('md5')`，性能更好
- 易踩参数顺序坑：`encrypt(plaintext, password, salt)` 中 **被加密的明文是 username**，PBE 密钥由 password 派生——第一次实现反了导致结果对不上

## 二、全局 snake_case 命名策略

### TypeORM 1.1 没有 SnakeNamingStrategy 了！

`typeorm` 1.x 只导出 `DefaultNamingStrategy`（0.3.x 的 `SnakeNamingStrategy` 已移除）。自己实现（`src/shared/database/snake-naming.strategy.ts`）：

```ts
import { DefaultNamingStrategy } from 'typeorm'
import type { NamingStrategyInterface } from 'typeorm'

export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  tableName(className: string, customName?: string): string {
    return customName ?? snakeCase(className)
  }
  columnName(propertyName: string, customName?: string, embeddedPrefixes: string[] = []): string {
    return snakeCase(embeddedPrefixes.concat('').join('_')) + snakeCase(customName ?? propertyName)
  }
  relationColumnName(propertyName: string, columnName: string): string {
    return snakeCase(propertyName + '_' + columnName)
  }
  joinColumnName(relationName: string, referencedColumnName: string): string {
    return snakeCase(relationName + '_' + referencedColumnName)
  }
  joinTableName(firstTableName: string, secondTableName: string, firstPropertyName: string, _secondPropertyName?: string): string {
    return snakeCase(firstTableName + '_' + firstPropertyName.replace(/\./gi, '_') + '_' + secondTableName)
  }
  joinTableColumnName(tableName: string, propertyName: string, columnName?: string): string {
    return snakeCase(tableName + '_' + (columnName ?? propertyName))
  }
  eagerJoinRelationAlias(alias: string, path: string): string {
    return alias + '__' + path.replace('.', '_')
  }
}

function snakeCase(str: string, char = '_'): string {
  return str
    .replace(/(?<=[a-z0-9])[A-Z]/g, match => char + match.toLowerCase())
    .replace(/(?<=[A-Z])[A-Z][a-z]/g, match => char + match.toLowerCase())
    .toLowerCase()
}
```

在 `src/config/database.config.ts` 挂载：`namingStrategy: new SnakeNamingStrategy()`。

效果：实体驼峰属性自动映射下划线列名（`createdAt→created_at`、`deptId→dept_id`、`workNo→work_no`），之前实体里显式 `@Column({ name: 'xxx' })` 的写法不再必需（显式指定仍优先生效，二者不冲突）。

### 配套：全库列名统一（迁移前半段）

启用策略前必须把库里已有的驼峰列全部改名，否则查询直接 `Unknown column`：

| 表 | 改名 |
| --- | --- |
| `dept` / `menu` | `parentId` → `parent_id` |
| `dict_item` | `dictTypeId` → `dict_type_id` |
| `login_log` | `userAgent` → `user_agent` |
| `oper_log` | `errorMsg` → `error_msg`（user_id 见下） |
| `role_menus` | `menuId`/`roleId` → `menu_id`/`role_id` |
| `task` | `assigneeId` → `assignee_id` |

### ManyToMany 关联列要显式指定

`user_roles` 关联表重建后列名为 `user_id`/`role_id`，为避免策略自动生成的列名不可控，`@JoinTable` 显式声明：

```ts
@JoinTable({
  name: 'user_roles',
  joinColumns: [{ name: 'user_id', referencedColumnName: 'id' }],
  inverseJoinColumns: [{ name: 'role_id', referencedColumnName: 'id' }]
})
```

## 三、sys_user 表替换（迁移后半段）

迁移 `1793765557497`：

1. `DROP TABLE user` → 按 JeecgBoot 定义建 `sys_user`（34 列全量：id varchar(32) 主键、password/salt、org_code、status 1正常/2冻结、del_flag、work_no 唯一、create_time/update_time、user_identity/depart_ids/client_id/bpm_status/sign 等），额外加一列 `dept_id int`（本项目扩展，对接部门模块，JeecgBoot 用 sys_user_depart 中间表做部门关联，我们先用简单外键列）
2. **导入 JeecgBoot 初始数据 4 条**：ceshi/zhangsan/jeecg/admin（含原密码与盐）
3. `user_roles` 重建：`user_id` int → varchar(32)；admin 用户绑定本库 admin 角色
4. `oper_log.user_id` int → varchar(32)、`tool_storage.user_id` int → varchar(32)

## 四、代码适配清单

| 文件 | 改动 |
| --- | --- |
| `user.entity.ts` | 重写：表名 `sys_user`、主键 `@PrimaryColumn({ type: 'varchar', length: 32 })`（非自增，服务端 `randomId32()` 生成）、全字段对齐、`status: 1正常/2冻结`、createTime/updateTime 普通列（不再 CreateDateColumn）、roles 关联显式列名 |
| `user.service.ts` | bcrypt → `encryptPassword`；create 生成 id/salt；update 禁改 username（密码算法绑定账号）、改密码自动换新盐；`verifyPassword()` 校验；`stripPassword` 同时剔除 password 与 salt；软删/keyword/`del_flag`/`create_time` 排序 |
| `auth.service.ts` | 移除 bcrypt；密码校验走 `userService.verifyPassword`；冻结判断 `status !== USER_STATUS.NORMAL`；`JwtPayload.id: string` |
| `jwt.strategy.ts` | `findOneWithRoles(String(payload.id))` |
| `user.controller.ts` | 所有 `:id` 移除 `ParseIntPipe`（字符串主键） |
| `create-user.dto.ts` | username 上限 100、status 枚举 1/2、其余字段对齐 |
| `oper-log.entity.ts` / `log.service.ts` / 拦截器 | `userId: number → string` |
| `storage.entity.ts` / `upload.service.ts` / `upload.controller.ts` | `userId: number → string` |
| `base.service.ts` | 泛型约束 `{ id: number }` → `{ id: number \| string }`；findOne/update/delete 参数 `number \| string`（user 的字符串主键与 role/menu 等数字主键共用基类） |

## 五、遇到的坑（重点学习）

1. **TypeORM 1.x 删掉了 SnakeNamingStrategy**——从 0.3 升到 1.x 的人几乎都会踩，需要自行实现（网上老教程直接 `import { SnakeNamingStrategy } from 'typeorm'` 会报 TS2305）
2. **Node/OpenSSL 3 禁用 DES**——`crypto.createCipheriv('des-cbc')` 直接 unsupported；JeecgBoot 的 PBEWithMD5AndDES 离不开 DES，用 crypto-js 的纯 JS 实现补位
3. **JeecgBoot 密码算法的参数顺序**——`encrypt(username, password, salt)`：PBE 密钥由 password 派生，被 DES 加密的明文却是 username；盐参与的是密钥派生（PBKDF1 迭代），不是 CBC 的 IV 之外的独立输入
4. **改密码必须连盐一起换**——盐随机生成后重新加密；且 username 不可改，否则旧密码全部失效
5. **换主键类型是牵一发动全身**——本次牵出 3 处 userId 列类型、BaseService 泛型、ParseIntPipe、JwtPayload、拦截器类型共 8 个文件；先全库 grep `userId`、`payload.id`、`req.user.id` 再动手

## 六、验证记录

- 迁移执行成功；DB 直查确认 `sys_user` 4 条 JeecgBoot 数据 + admin 绑定 admin 角色
- **admin/123456 登录成功**（JeecgBoot 密码算法验证）✓；错误密码 admin123 被拒 ✓
- 创建用户 wangwu（32 位主键、盐+算法加密、createBy=admin）→ **新用户密码登录成功** → 软删后列表消失 ✓
- snake 策略回归：menus/tree、depts/tree、dict-items/code、notices/published、logs/login 全部正常 ✓
- build / eslint / oxlint 全绿

## 七、怎么扩展

- **测试账号**：admin/123456（管理员）、jeecg、zhangsan、ceshi 密码均 123456
- **下一张表**：role → `sys_role`（name→role_name、label→role_code...）、menu → `sys_permission`、dept → `sys_depart`，套路同本轮：迁移改名/重建 + 实体对齐 + snake 策略自动映射
- **密码算法说明**：PBEWithMD5AndDES 是 JeecgBoot 历史包袱（DES 已不安全），保持兼容是本表对齐的前提；若后续脱离 JeecgBoot 数据可整体换 bcrypt
