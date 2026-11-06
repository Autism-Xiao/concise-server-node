# sql/ 数据脚本目录

存放与代码迁移无关的**业务数据初始化/批量导入 SQL**，按 `表名_数据描述_年份.sql` 命名。

## 当前文件

| 文件 | 说明 |
| --- | --- |
| `sys_region_data_2024.sql` | 行政区划全量数据（国家统计局 2024，34 省 + 344 市 + 3255 区县 + 41350 镇街，共 44983 条） |
| `concise_server_full_2026-11-07.sql` | 全库备份快照（2026-11-07，24 张表结构 + 数据，约 8MB，含区划/用户/角色/菜单/字典/日程等全部业务数据） |

## 导入方式

```bash
# 前置：已运行迁移 1794090000000（建 sys_region 表并预置 34 个省级）
export MYSQL_PWD=你的密码
"C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe" -uroot --default-character-set=utf8mb4 concise_server < sql/sys_region_data_2024.sql
```

- 语句为 `INSERT IGNORE`（按 `area_code` 唯一索引去重），**重复导入安全，不会覆盖已有行**
- 单文件约 5MB，内部已按 500 条/批分批并包在事务里
- 数据源头与生成脚本见 `scripts/import-region-2024.cjs`（CSV → SQL，拼音自动生成）

## 全库快照恢复方式

```bash
export MYSQL_PWD=你的密码
"C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe" -uroot --default-character-set=utf8mb4 -e "DROP DATABASE IF EXISTS concise_server; CREATE DATABASE concise_server DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
"C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe" -uroot --default-character-set=utf8mb4 concise_server < sql/concise_server_full_2026-11-07.sql
```

- 全库快照含 `sys_user` 的密码哈希等敏感数据，**仓库若公开需先评估**，或改放私有备份存储
- 恢复后 `.env` 的 JWT_SECRET 若与快照生成时不同，所有已签发 token 失效（重新登录即可）
