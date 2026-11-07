# sql/ 数据脚本目录

存放数据库快照与可复用的业务数据脚本，按 `用途_日期.sql` 命名。

## 当前文件

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `concise_server_full_2026-11-07.sql` | 7.7 MB | 全库快照（2026-11-07 19:36 导出）：**28 张表结构 + 50,368 行数据**，含区划 44,983 / 用户 194 / 权限 134 / 操作日志 4,750 / 租户 3 / 用户水印配置 4 / 公告 48 / 日程与提醒 15 |

## 快照包含什么

- 全部表的 `CREATE TABLE` 与全量数据（`--single-transaction --quick`，导出期间不锁表）
- 存储过程 / 函数 / 触发器 / 事件（`--routines --events --triggers`）
- 二进制字段按十六进制输出（`--hex-blob`），避免还原时乱码
- **不含** `CREATE DATABASE`，恢复前需先手工建库

## 恢复方式（整库覆盖，慎用）

```bash
export MYSQL_PWD=你的密码
MYSQL="C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe"

# 1) 重建库（会清空现有全部数据）
"$MYSQL" -uroot --default-character-set=utf8mb4 -e "DROP DATABASE IF EXISTS concise_server; CREATE DATABASE concise_server DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 2) 导入快照
"$MYSQL" -uroot --default-character-set=utf8mb4 concise_server < sql/concise_server_full_2026-11-07.sql
```

- 全库快照含 `sys_user` 的密码哈希、租户数据等敏感内容，**仓库若公开需先评估**，或改放私有备份存储
- 恢复后 `.env` 的 `JWT_SECRET` 若与快照生成时不同，所有已签发 token 失效（重新登录即可）
- 快照文件名带日期，恢复前确认用的是最新那份

## 重新导出快照（结构或数据有较大变更后）

```bash
cd E:/oneself/concise/concise-server-node
DB_PWD=$(grep '^DB_PASSWORD=' .env | cut -d= -f2-)
MYSQL_PWD="$DB_PWD" "C:/Program Files/MySQL/MySQL Server 8.4/bin/mysqldump.exe" \
  -h127.0.0.1 -P3306 -uroot \
  --default-character-set=utf8mb4 --single-transaction --quick --no-tablespaces \
  --set-gtid-purged=OFF --routines --events --triggers --hex-blob \
  concise_server > sql/concise_server_full_$(date +%F).sql
```

导出后建议先导入一个临时库（如 `concise_server_verify`）逐表比对行数，确认能还原再提交，然后 `DROP DATABASE concise_server_verify`。

## 区划数据说明

`sys_region` 的 44,983 条（34 省 + 344 市 + 3,255 区县 + 41,350 镇街）已包含在全库快照里，**不再单独维护 sql 文件**。

需要单独重建区划时：

```bash
node scripts/import-region-2024.cjs   # CSV → SQL（拼音自动生成），产出 INSERT IGNORE 脚本后再导入
```

- 该脚本产出 `INSERT IGNORE`（按 `area_code` 唯一索引去重），重复导入安全、不会覆盖已有行
- 历史版本 `sys_region_data_2024.sql` 已从仓库移除，需要时从 git 历史取回
