# 数据库备份到 deploy/sql（含 dump 脚本输出目录参数）

- 日期：2026-11-19
- 类型：运维 + 工具增强

## 背景

用户要求把 MySQL 数据库备份到 `deploy/sql/` 下。原有 `scripts/dump-sql.mjs` 只能固定输出到 `sql/`，`deploy/sql/` 目录已存在但只有 `.gitkeep` 占位。

## 文件清单

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `scripts/dump-sql.mjs` | 修改 | 新增 `--out-dir=<目录>` 参数（相对项目根，用 `resolve` 解析），不传时仍输出到 `sql/`，完全向后兼容 |
| `deploy/sql/concise_server_full_2026-11-19.sql` | 新增（数据产物） | 本次全量备份，7.9 MB / 1498 行 / 43 个 CREATE TABLE，含 routines/events/triggers，utf8mb4 单事务一致性快照 |
| `docs/README.md` | 修改 | 追加本条索引 |

## 每项作用

- **`dump-sql.mjs --out-dir`**：把mysqldump 产物写到指定目录。本次执行 `node scripts/dump-sql.mjs --out-dir=deploy/sql`，生成 `deploy/sql/concise_server_full_2026-11-19.sql`。文件名规则不变（`concise_server_{full|schema}_YYYY-MM-DD.sql`）。
- **备份选项**：沿用脚本既有配置——`--single-transaction --quick --no-tablespaces --set-gtid-purged=OFF --routines --events --triggers --hex-blob`，`utf8mb4`，密码通过 `MYSQL_PWD` 传（不进命令行/进程列表）。
- **验证结果**：文件头 `MySQL dump 10.13 Distrib 8.4.9`、尾 `Dump completed on 2026-11-19 19:29:15`；关键表 `sys_user / sys_tenant / sys_config / sys_role / sys_log` 齐全；库内 41 张业务表均可还原。

## 踩的坑

1. **mysqldump 路径含空格**：`C:/Program Files/MySQL/MySQL Server 8.4/bin/mysqldump.exe`，脚本用 `spawn` 参数数组方式传路径不涉及 shell，安全；若换机器用 `MYSQLDUMP_PATH` 环境变量覆盖。
2. **密码绝不进命令行**：连库信息取自 `.env`，密码经 `MYSQL_PWD` 环境变量传给 mysqldump，避免出现在进程列表和错误输出（脚本里还专门正则抹掉 `Using a password` 警告行）。
3. **UTC 时区坑**：文件名日期用 `toLocaleDateString('sv-SE')` 取本地日期，不用 `toISOString()`（UTC 晚上导出会差一天）。
4. **备份文件含真实数据**：`.gitignore` 目前**未忽略** `deploy/sql/*.sql`（`git check-ignore` 返回未忽略），该文件会进入 git status。含生产/测试真实数据，提交前需确认是否纳入版本控制（见交付说明）。
5. **同名覆盖**：按日期命名，同一天再次执行会覆盖当天文件（原脚本既有行为）。

## 如何扩展

- 只导结构：`node scripts/dump-sql.mjs --out-dir=deploy/sql --schema-only`。
- 指定文件名日期：`--date=2026-11-19`；自定义 mysqldump：`MYSQLDUMP_PATH=...`。
- 若要把备份目录排除出 git：在 `.gitignore` 增加 `deploy/sql/*.sql`（保留 `deploy/sql/.gitkeep`）。
- 服务端自动备份走 `src/shared/backup/db-backup.service.ts`（输出 `sql/backups/`，已被 gitignore，带校验与保留 N 份策略），与手动 dump 目录互不冲突。
