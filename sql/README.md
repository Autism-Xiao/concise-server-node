# sql/ 数据脚本目录

存放数据库快照与可复用的业务数据脚本，按 `用途_日期.sql` 命名。

## 当前文件

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `concise_server_full_2026-11-10.sql` | 6.5 MB | **最新全库快照**（2026-11-10 19:50 导出）：31 张表结构 + 45,962 行数据，含区划 44,983 / 权限 149 / 角色授权 521 / 操作日志 91 / 迁移记录 51 / 文件 35 / 部门 21 |
| `concise_server_full_backup-pre-restore.sql` | 7.8 MB | 替换前的当前库备份（2026-11-10 23:59 导出）：11-10 快照恢复执行前的现场，回滚用 `DROP+CREATE` 后导入本文件即可 |
| `concise_server_full_2026-11-07.sql` | 7.7 MB | 历史快照（2026-11-07 19:36 导出，28 张表 / 50,368 行）：留档对比用，**恢复请用最新文件** |

与 11-07 相比新增 3 张表：`supplier`、`sys_message`、`sys_message_user`。

## 快照包含什么

- 全部表的 `CREATE TABLE` 与全量数据（`--single-transaction --quick`，导出期间不锁表）
- 存储过程 / 函数 / 触发器 / 事件（`--routines --events --triggers`；当前库没有存储过程，加了也不会多内容）
- 二进制字段按十六进制输出（`--hex-blob`），避免还原时乱码
- **不含** `CREATE DATABASE`，恢复前需先手工建库
- 2026-11-10 快照**已包含全部已执行迁移**（`migrations` 51 条）：`sys_user.bio`、`sys_message` / `sys_message_user`、`supplier` 等都在内，恢复后不用再补 schema

## 恢复方式（整库覆盖，慎用）

```bash
# 1) 重建库（会清空现有全部数据）
mysql -uroot -p -e "DROP DATABASE IF EXISTS concise_server; CREATE DATABASE concise_server COLLATE utf8mb4_unicode_ci;"

# 2) 导入快照（全量，含迁移结果，无需再补 schema）
mysql -uroot -p --default-character-set=utf8mb4 concise_server < sql/concise_server_full_2026-11-10.sql
```

## 重新导出快照（结构或数据有较大变更后）

```bash
node scripts/dump-sql.mjs                    # 全量 → sql/concise_server_full_YYYY-MM-DD.sql
node scripts/dump-sql.mjs --schema-only      # 只导结构 → sql/concise_server_schema_YYYY-MM-DD.sql
node scripts/dump-sql.mjs --date=2026-11-10  # 指定文件名里的日期
```

- 连接信息从 `.env` 读（`DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_DATABASE`），密码通过 `MYSQL_PWD` 传给 mysqldump，**不出现在命令行**
- mysqldump 路径默认 `C:/Program Files/MySQL/MySQL Server 8.4/bin/mysqldump.exe`，可用环境变量 `MYSQLDUMP_PATH` 覆盖
- 导完建议按「恢复方式」在临时库里导一遍验证（表数应与源库一致，2026-11-10 实测 31 张）


## 区划数据说明

`sys_region` 的 44,983 条（34 省 + 344 市 + 3,255 区县 + 41,350 镇街）已包含在全库快照里，**不再单独维护 sql 文件**。

需要单独重建区划时：

```bash
node scripts/import-region-2024.cjs   # CSV → SQL（拼音自动生成），产出 INSERT IGNORE 脚本后再导入
```

- 该脚本产出 `INSERT IGNORE`（按 `area_code` 唯一索引去重），重复导入安全、不会覆盖已有行
- 历史版本 `sys_region_data_2024.sql` 已从仓库移除，需要时从 git 历史取回
