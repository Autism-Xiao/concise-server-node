# 变更文档索引

按日期倒序登记 `docs/` 下的变更说明。每条包含主题、类型（新增/修复/增强/运维/测试）与一句话要点。

| 日期 | 主题 | 类型 | 要点 |
| --- | --- | --- | --- |
| 2026-11-17 | [前端 dev server 双栈监听](./2026-11-17-前端dev-server双栈监听.md) | 修复 | 「项目没起来」实测是 vite 默认只把 `localhost` 解析成 IPv6 的 `::1` 并单栈监听，`127.0.0.1:5173` 直接连接被拒（curl 000），而终端横幅只印 `localhost`，两边信息对不上。`server.host` 改为默认 `'::'`（双栈，IPv4/IPv6 都通，可用 `FRONTEND_HOST` 覆盖），启动横幅同时打印两个地址。验证：netstat 显示 `0.0.0.0:5173`、两个地址均 200、`/backend-api` 代理 401、无头浏览器在 IPv4 下登录页与仪表盘完整渲染 |
| 2026-11-17 | [整库恢复到 11-17 快照](./2026-11-17-整库恢复到11-17快照.md) | 运维 | 按要求用 `sql/concise_server_full_2026-11-17.sql` 整库覆盖：先 mysqldump 备份当前 33 表现场（`sql/concise_server_full_backup-pre-restore-2026-11-17.sql`，7.4MB，唯一回滚入口）→ 停 3000 → DROP+CREATE（显式 utf8mb4_unicode_ci）→ 导入 → 校验 41 表 / 49,423 行 / 72 迁移 → 重启。途中发现 **`.env` 被 22:19 的仓库更新清掉了**（gitignore 未跟踪），启动报缺 JWT_SECRET；按 .env.example 重建并新生成双密钥（旧 token 全失效需重登）。坑：`@IsOptional()` 不兜空字符串，`SWAGGER_ENABLED=` 留空会挂在 `IsIn` 校验上；快照不带 CREATE DATABASE；导入前必须停后端 |
