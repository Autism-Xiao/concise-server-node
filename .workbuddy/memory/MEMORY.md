# 项目长期记忆：concise-server-node

## 用户强规则（每次必须遵守）

- **每轮改完代码必须在 `docs/` 新建 `YYYY-MM-DD-主题.md`**：文件清单表格（文件/类型/说明）、每项作用、踩的坑、如何扩展；并在 `docs/README.md` 表格追加一行摘要；随后与代码一起提交推送。

## 环境与命令

- **包管理器 pnpm，禁 `npm install`**（崩 `Cannot read properties of null (reading 'matches')`）。装包 `pnpm add`，恢复 `pnpm install --force`。顶层 require 不到 express 是 pnpm 不提升的正常现象；完整性看 `ls node_modules/.pnpm | wc -l`（约 1000）。
- Node 24，命令需 `PATH="/d/projram/nodejs:$PATH"`；NestJS 12 CJS + Jest + oxlint + ESLint 9 flat + Prettier（单引号/无分号/160 列/无尾逗号/arrowParens avoid）+ husky→lint-staged（别手动 format）。TypeORM 1.1 + MySQL 8.4（服务 `MySQL84`，root/123456，库 `concise_server`）。
- 端口：后端 `.env` `PORT=3459`；**前端管理后台在 5173**（vite 代理 `/backend-api`→后端，端口自动读后端 .env）。测试实例用 3461 + `CAPTCHA_ENABLED=false`；3457 被外部代理占用。
- **重启后端**：`npm run restart` 会「假重启」（清 dist 被 safe-delete 钩子拦，`&&` 短路后 serve.mjs 没跑但输出像成功）。被拦就「先 `npm run build`（走审批）+ `node scripts/serve.mjs`」；绝不用 `nest start --watch`。判新代码生效：`curl /api/v1/<新路由>` 404=旧进程 / 401=新的。后台起 serve.mjs 会被标 failed（父退出子存活）别当挂了；启动命令别接管道（head 关管道会杀子进程）。
- 给用户的终端命令用 **PowerShell 5.1 语法**（无 `&&`/`||`/三元/`??`）：`npm run build; if ($?) { ... }`、`$env:PORT="3459"`。
- 统一响应 `{ code, message, result, success, timestamp }`（**是 result 不是 data**）；业务异常靠 code 区分（可 HTTP 200）；全局 ValidationPipe(transform+whitelist)。泛型需 `extends ObjectLiteral`；query DTO 加 `@Type(()=>Number)`。

## 文档端点

`/api/docs` = Scalar（modern+saturn，2026-11-11 换）；`/api/docs-ui` = 原 swagger-ui 备用（自托管，断网可用）；`/api/docs-json` = OpenAPI JSON（`jsonDocumentUrl` 钉死，冒烟脚本依赖）。新模块 DTO 加 `@ApiProperty`、Controller 加 `@ApiTags`/`@ApiOperation`，Bearer 方案名 `'jwt'`。`GET /` 302 到 docs、`/favicon.ico` 204 —— 两条顶层路由必须用 express 实例注册（Controller 会被 globalPrefix 变成 `/api`）且排在 helmet 之后（否则丢安全头）。

## 安全基线

全局 `RateLimitGuard`（120/60/IP/路由）+ 高危接口 `@RateLimit({limit,window,by})`；上传只允许位图且过 `detectImageSignature` 文件头校验，禁 SVG；多步写用 `manager.transaction`（事务内一律 `manager.getRepository()`）；唯一键先查重（含软删占用）+ 捕获 ER_DUP_ENTRY→400（`utils/db-error.util.ts`）；业务错优先 `BadRequestException`；限流 429 / 锁定 1009。

## 错误码

`src/common/enums/biz-error-code.enum.ts`：冻结段（0/41x/1001~1009/429/503，**只增不改**）+ 21xx 认证 / 31xx 角色 / 41xx 组织 / 51xx 配置 / 61xx 导入 / 71xx 协作 / 81xx 租户 / 91xx 运维。**加码铁律：一码一消费者**（写明谁按它分支，否则是死码，414/415/416 已删）；同类细节靠 message 区分。抛错用 `BizException(code, '人话文案')`。过滤器：BizException 用枚举码 / 已知 HttpException 查映射 / 未映射 4xx 用 status 本身 / 仅 5xx 回落 1006。前端只登记真正按码分支的（`lib/biz-code.ts`：1009/6103/6104/2105/2106），其余展示后端 message；401 有双重判定（`status===401` 在 parseJsonBody 前 + `code===401` 网关兼容分支，被 `tests/http-unauthorized.test.cjs` 锁定别删）。导入域：结构不对 6103、空文件 6104，单点 `helper/import/excel-import.ts` 的 `assertImportRows()`；行数超限仍是 1001。`/v1/files/purge` 的 ids 必须是字符串数组。

## 关键机制（改动前先读）

- **权限**：user—role—menu 多对多（user_roles/role_menus），全局 JwtAuthGuard→RolesGuard→PermsGuard 顺序注册；`@Public()`/`@Roles()`/`@Perms()`（实时查 menu.permission，admin bypass）。权限集合走 `PermissionCacheService`，改 role_permission 必调 invalidateRole/invalidateAll。跨模块 `@InjectRepository` 必须本模块 forFeature 注册对方实体。
- **密码**：新数据 Argon2id（m=19456/t=2/p=1），历史 jeecg 格式登录成功后就地升级；`verifyPassword` 是异步的，调用要 await。双令牌 access 2h / refresh 7d。
- **2FA**：纯 `node:crypto` 的 TOTP（RFC6238/HMAC-SHA1/30s/6 位/±1 步 `timingSafeEqual`）；`sys_user.totp_secret` 是 `select:false` → 认证查询必须显式 `addSelect`，否则门禁静默失效；无码 2105 / 错码 2106 且不计入锁定；`/v1/auth/2fa/{status,setup,activate,deactivate}`。已知限制：SSO 不校验、备份恢复码未做。
- **多租户**：`sys_tenant` + `sys_user_tenant` + `sys_user.login_tenant_id`；9 张业务表 `tenant_id`（**0 = 平台共享，所有租户可见**）。隔离唯一入口 `shared/tenant/tenant-scope.util.ts`（null 不过滤 / 0 只看共享 / >0 本租户+共享）；上下文必须由全局中间件 `TenantContext.run` 建立（Guard 里 set 无效）；手写 QB 要 `applyTenantScope`（用 andWhere+Brackets，别 where 覆盖）。前端 localStorage `concise-tenant` → 自动带 `X-Tenant-Id`。建租户自动生成 admin/editor/viewer 模板（`tenant-role-template.ts`，admin `is_builtin=1`）；平台新增租户级菜单后要跑 `POST /v1/tenants/provision-all`。
- **数据权限**：`sys_role.data_scope` 走 `UserService.countScoped`；`scope === ALL(1)` 必须直接放行（漏了会 `1=0` 一条查不到）。首页 `GET /v1/dashboard/overview` 不挂 `@Perms`，**无权限的块返回 null 不是 0**，降级块带 `scope:'all'|'self'`；前端只判 null 不判权限。
- **水印**：`resolveWatermarkState` 是唯一判定入口（off > enforced=2 > enforced=1 > forced > 用户??全局）；用户侧只能改 enabled/content/density，样式参数仅全局可改。
- **界面设置上云**：`sys_user_setting`（**故意无 tenant_id**）+ `GET|PUT /v1/users/me/settings`；白名单唯一入口 `user-setting.util.ts`，**加设置项必须同步改**；库里只存差异（`stripDefaultSettings`）；前端 `lib/settings.ts` 不能用 `getApiResult`（401 会踢登录页）。
- **数据库约定**：新表显式 `COLLATE=utf8mb4_unicode_ci`（sys_user 是 unicode_ci，默认 0900_ai_ci JOIN 会炸）；`@Column({length})` 可空要显式 `type:'varchar'`（否则推断成 Object）；`Pagination` 无链式方法，列表一律 `toPagination()`，数据源类（tree/options/code）才返数组。

## 测试数据与冒烟（本地 dev 库）

- `admin / admin123`（超管 id=1）；`guest / guest123`（无角色）；`auditor1`（仅 system:log:*）。角色 admin/editor/viewer **每租户各一套**（看到「角色重复」是同名模板，不能删）。
- `scripts/smoke-*.mjs`：dashboard 60 / tenant 26 / provision 27 / user-setting 18 / captcha 18 / batch-io 31，需 `PORT=3461 CAPTCHA_ENABLED=false` 实例（captcha 脚本相反，要 `true`，否则退出码 2）。
- 跑单测用 `npm test`（= `node --test tests/*.test.cjs`），直接 `node --test tests/` 会全红。

## 遗留 / 下一步

- 任务 `assignee_id` 已迁 varchar；`GET /v1/tasks/mine` 刻意不加租户隔离。
- 可选：字典/公告/任务按钮权限录入菜单、验证码接 Redis 支持多实例、操作日志导出。
- 设计未落地：「个人权限可监管别的部门」→ 建议新表 `sys_user_supervise_dept`，`applyDataScope` 合并 own ∪ supervise（用户中断未确认，未开发）。
