# sql/ 数据脚本目录

存放与代码迁移无关的**业务数据初始化/批量导入 SQL**，按 `表名_数据描述_年份.sql` 命名。

## 当前文件

| 文件 | 说明 |
| --- | --- |
| `sys_region_data_2024.sql` | 行政区划全量数据（国家统计局 2024，34 省 + 344 市 + 3255 区县 + 41350 镇街，共 44983 条） |

## 导入方式

```bash
# 前置：已运行迁移 1794090000000（建 sys_region 表并预置 34 个省级）
export MYSQL_PWD=你的密码
"C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe" -uroot --default-character-set=utf8mb4 concise_server < sql/sys_region_data_2024.sql
```

- 语句为 `INSERT IGNORE`（按 `area_code` 唯一索引去重），**重复导入安全，不会覆盖已有行**
- 单文件约 5MB，内部已按 500 条/批分批并包在事务里
- 数据源头与生成脚本见 `scripts/import-region-2024.cjs`（CSV → SQL，拼音自动生成）
