# sql/ 数据脚本目录

存放数据库快照与可复用的业务数据脚本，按 `用途_日期.sql` 命名。

## 当前文件

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `concise_server_full_2026-11-17.sql` | 7.2 MB | **最新全库快照**（2026-11-17 19:38 导出）：41 张表结构 + 全量数据，含区划 44,983 / 操作日志 1,600 / 权限 182 / 角色授权 839 / 租户套餐 1,457 / 迁移记录 72 / 租户 5 / 用户 10 / 字典项 22。相对 11-16 新增：**多租户强化**（`sys_tenant_menu` 功能套餐表、`sys_log.is_proxy` 代维标记、`sys_quartz_job.tenant_id` 任务归属、`sys_dict_item (dict_id,item_value)` 唯一键、`security.platformAdmin.require2fa` 参数）。已在临时库 `concise_verify_1117` 整库导入验证：41 表全中、关键表行数逐项一致（`sys_log` 少 2 条为导出后新增日志，属正常时间差） |
| `concise_server_full_backup-pre-restore-2026-11-17.sql` | 7.4 MB | **11-17 覆盖动作的回滚点**（2026-11-17 22:23 导出）：执行「用 11-17 快照整库覆盖」之前那一刻的现场，33 张表 / 55 条迁移（含代码生成器产出的 `customer`、`biz_order` 及其数据）。要退回覆盖前状态：`DROP DATABASE` 后导入本文件即可 |
| `concise_server_full_2026-11-16.sql` | 6.8 MB | 历史全库快照（2026-11-16 19:28 导出）：40 张表结构 + 全量数据，含区划 44,983 / 操作日志 1,035 / 权限 177 / 角色授权 602 / 迁移记录 61 / 存储对象 38 / 部门 25 / 字典项 22 / 用户 6。已包含开放平台（`sys_app` / `sys_app_secret` / `sys_webhook` / `sys_webhook_delivery`）、字段级审计（`sys_log_change`）、界面设置（`sys_user_setting`）等全部新表与迁移。**注意**：同日 12:30 那份「覆盖前旧库现场」已被本次导出覆盖，需要回滚到覆盖前状态请用 `_2026-11-15` |
| `concise_server_full_2026-11-15.sql` | 6.8 MB | 历史全库快照（2026-11-15 22:36 导出）：33 张表结构 + 46,918 行数据。**2026-11-16 已用它整库覆盖本机 `concise_server`**（导入 exit 0 / 33 表 / 46,918 行逐项核对一致），也是 11-16 覆盖动作的回滚点 |
| `concise_server_full_2026-11-10.sql` | 6.5 MB | 历史快照（2026-11-10 19:50 导出）：31 张表 / 45,962 行，保留对照 |
| `concise_server_full_backup-pre-restore.sql` | 7.8 MB | 11-10 快照恢复执行前的现场（2026-11-10 23:59 导出）：那一次回滚用的备份，现已无回滚需求 |
| `concise_server_full_2026-11-07.sql` | 7.7 MB | 历史快照（2026-11-07 19:36 导出，28 张表 / 50,368 行）：留档对比用，**恢复请用最新文件** |

表数量演进：11-07 28 张 → 11-10 31 张（新增 `supplier`、`sys_message`、`sys_message_user`）→ 11-15 33 张（新增 `customer`、`biz_order`，均由代码生成器产出）→ 11-16 40 张（新增 `sys_log_change`、`sys_user_setting`、`sys_app`、`sys_app_secret`、`sys_webhook`、`sys_webhook_delivery`、`sys_watermark_setting`）→ 11-17 41 张（新增 `sys_tenant_menu`，功能套餐）。

## 快照包含什么

- 全部表的 `CREATE TABLE` 与全量数据（`--single-transaction --quick`，导出期间不锁表）
- 存储过程 / 函数 / 触发器 / 事件（`--routines --events --triggers`；当前库没有存储过程，加了也不会多内容）
- 二进制字段按十六进制输出（`--hex-blob`），避免还原时乱码
- **不含** `CREATE DATABASE`，恢复前需先手工建库
- 2026-11-17 快照**已包含全部已执行迁移**（`migrations` 72 条），恢复后不用再补 schema，也不用重跑 `provision-all`（角色授权与租户套餐随 `sys_role_permission` / `sys_tenant_menu` 一起恢复）

## 恢复方式（整库覆盖，慎用）

```bash
# 1) 重建库（会清空现有全部数据）
mysql -uroot -p -e "DROP DATABASE IF EXISTS concise_server; CREATE DATABASE concise_server COLLATE utf8mb4_unicode_ci;"

# 2) 导入快照（全量，含迁移结果，无需再补 schema）
mysql -uroot -p --default-character-set=utf8mb4 concise_server < sql/concise_server_full_2026-11-17.sql
```

## 重新导出快照（结构或数据有较大变更后）

```bash
node scripts/dump-sql.mjs                    # 全量 → sql/concise_server_full_YYYY-MM-DD.sql
node scripts/dump-sql.mjs --schema-only      # 只导结构 → sql/concise_server_schema_YYYY-MM-DD.sql
node scripts/dump-sql.mjs --date=2026-11-10  # 指定文件名里的日期
```

- 连接信息从 `.env` 读（`DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_DATABASE`），密码通过 `MYSQL_PWD` 传给 mysqldump，**不出现在命令行**
- mysqldump 路径默认 `C:/Program Files/MySQL/MySQL Server 8.4/bin/mysqldump.exe`，可用环境变量 `MYSQLDUMP_PATH` 覆盖
- 导完建议按「恢复方式」在临时库里导一遍验证（表数与行数应与源库一致，2026-11-17 实测 41 张 / migrations 72 条）


## 区划数据说明

`sys_region` 的 44,983 条（34 省 + 344 市 + 3,255 区县 + 41,350 镇街）已包含在全库快照里，**不再单独维护 sql 文件**。

需要单独重建区划时：

```bash
node scripts/import-region-2024.cjs   # CSV → SQL（拼音自动生成），产出 INSERT IGNORE 脚本后再导入
```

- 该脚本产出 `INSERT IGNORE`（按 `area_code` 唯一索引去重），重复导入安全、不会覆盖已有行
- 历史版本 `sys_region_data_2024.sql` 已从仓库移除，需要时从 git 历史取回
