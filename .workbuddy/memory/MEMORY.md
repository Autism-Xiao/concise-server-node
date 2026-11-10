# 项目长期记忆：concise-server-node

## 用户强规则（每次必须遵守）

- **每轮生成/修改代码后，必须在 `docs/` 下新建一个 `.md` 变更说明文档**（命名 `YYYY-MM-DD-主题.md`），内容包含：改了哪些文件（表格：文件/类型/说明）、每个东西是干什么的、遇到的坑、怎么扩展/使用。完成后随代码一起提交推送。

## 项目约定

- **给用户的终端命令要用 PowerShell 5.1 语法**：用户在自己终端里粘贴执行，`&&`/`||`/三元/`??` 都会报「不是有效语句分隔符」。多命令用 `npm run build; if ($?) { npm run start:prod }`，环境变量用 `$env:PORT="3459"`。（我自己用 Bash 工具时仍可用 `&&`）
- **重启后端一律 `npm run restart`**（= `nest build` + `scripts/serve.mjs`，启动前自动结束旧的 `dist/main.js` 实例），**绝不用 `nest start --watch`** —— watch 启动前清 dist 会被 safe-delete 钩子拦死（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）。裸跑 `node dist/main.js` 撞端口会 EADDRINUSE，查占用者用 `node scripts/serve.mjs --dry-run`
  - **`npm run restart` 会「假重启」**：`nest build` 清 dist（700+ 文件）同样会被 safe-delete 拦，`&&` 短路后 `serve.mjs` 根本没跑，但输出看着像成功。判断法：`curl /api/v1/<新路由>` 回 **404 = 路由没注册（旧进程）**，回 401 才是新代码在跑。被拦时改用「先 `npm run build`（会走审批绕过）、再 `node scripts/serve.mjs`」
  - **后台启动 `serve.mjs` 的任务会被标成 failed**（父进程退出、子进程存活），别当成服务挂了：用 `curl /api/docs-json` 看路由是否已注册，或看 3459 上 node 进程的 StartTime 是否晚于 dist 构建时间
  - **启动服务的命令不要接管道**（`node scripts/serve.mjs | head -20`）：head 读满行关管道 → 子进程被杀，任务却显示 `completed exit 0`
- NestJS 12 CJS + Jest + oxlint；TypeORM 1.1 + MySQL 8.4（本机服务 `MySQL84`，root/123456，库 `concise_server`）
- 参照 E:\project\demo\nest-admin 演进为中后台架构
- 工程链：ESLint 9 flat config（正确性）+ Prettier（`.prettierrc.js`，用户指定风格：**单引号/无分号/160 列/无尾逗号/arrowParens avoid**）+ oxlint（lint:ox 二道）+ husky pre-commit → lint-staged（staged .ts 跑 eslint --fix + prettier --write）。commit 前不要手动跑 format，钩子会处理。
- 统一响应 `{ code, message, result, success, timestamp }`（**是 `result` 不是 `data`**，早期笔记记错过，写冒烟脚本时按 `data` 取会全 undefined）；业务异常也是 HTTP 200/4xx 靠 `code` 区分；全局 ValidationPipe（transform + whitelist）
- 泛型需 `extends ObjectLiteral`；query 参数 DTO 加 `@Type(() => Number)`；运行命令需 `PATH="/d/projram/nodejs:$PATH"`（Node 24）
- 3000 端口被外部进程占用，本地测试用 `PORT=3457`
- Swagger 文档（912b3ed）：`/api/docs` 在线 UI、`/api/docs-json` OpenAPI JSON。约定：新模块 DTO 加 @ApiProperty、Controller 加 @ApiTags + @ApiOperation；Bearer 方案名 'jwt'。文档规则：每轮改动在 docs/ 生成变更 .md（见下方强规则）。
- 下一步：可选项——字典/公告/任务按钮权限在菜单管理录入、验证码接 Redis 支持多实例、操作日志导出
- RBAC 完成（52ae21e）：user—role—menu 三级多对多（user_roles/role_menus），全局 JwtAuthGuard→RolesGuard（APP_GUARD 顺序注册），@Public()/@Roles() 装饰器，菜单树 GET /menus/tree。角色/菜单/用户模块类级 @Roles('admin')。坑：跨模块注入仓库需 imports 对方模块；TypeORM findOne 同时用 relations+select 会报 distinctAlias 错（用 QueryBuilder addSelect+leftJoinAndSelect 代替）。测试数据：角色 admin/viewer/editor，用户 admin(admin)/guest(无角色，密码 guest123)，菜单 系统管理→用户管理。
- 已完成 auth 模块（889333c）：POST /auth/login、/auth/refresh、GET /auth/profile（JwtAuthGuard）。bcryptjs 哈希（UserService.create/update 自动处理）；jwt.strategy validate() 每次查库核对用户状态；双令牌 accessToken(2h)/refreshToken(7d) 从 .env 读。测试账号 admin/admin123（id=1）。类型坑：expiresIn 需 `StringValue` from 'ms'（@types/ms）。
- 三件套完成（a3ccc51）：① @Perms 按钮级权限（perms.guard.ts 实时查 menu.permission，admin bypass，守卫顺序 Jwt→Roles→Perms）；② 登录日志（AuthService.login 记成败）+ 操作日志（OperLogInterceptor 全局拦截写操作，密码脱敏，@OperLog 声明模块名）；③ 部门模块 system/dept（树+CRUD+防环+删除保护），user 实体加 deptId。日志接口权限用 @Perms 而非 @Roles（auditor 角色 403 验证过）。表：dept/login_log/oper_log、user.deptId。测试数据：auditor1（角色 auditor，仅 system:log:*）。
- 字典模块完成（02ea1ae）：system/dict-type + dict-item，code 唯一索引、同类型 value 唯一、有字典项禁删；GET /dict-items/code/:code 所有登录用户可用（下拉框数据源）。用户详情/列表/创建/更新返回都带 dept。坑：跨模块 @InjectRepository 必须本模块 forFeature 注册对方实体；select 数组含 'sort' 与原型方法类型冲突（用对象形式）；oxlint no-misused-spread 对实体展开组树加行内 disable。本地测试端口换 3459（3457 被外部代理占用）。演示字典：sys_user_gender、sys_menu_status。
- 验证码/日志/公告/任务完成（0454f8a）：① svg-captcha 验证码（内存 Map 5min 一次性，GET /auth/captcha @Public，CAPTCHA_ENABLED 开关，CAPTCHA_DEBUG 附明文仅供开发）；② 日志联调支持（startTime/endTime ISO 过滤、/:id 详情、DELETE 批量删 @Perms system:log:delete）；③ 公告 system/notice（草稿/发布 + publishedAt 自动维护 + GET /notices/published 全员）；④ 任务 system/task（状态机：待处理→进行中/已取消，进行中→已完成，已取消可重开）。坑：@Type(()=>Date) 会先转 Date 导致 @IsISO8601 必挂——DTO 保持 string 校验、Service 转 Date；DTO dueDate:string vs 实体 Date 签名用 Omit 交叉类型解决。

## 安全基线（2026-11-06 起，新接口照此办理）

- 全局 `RateLimitGuard` 在最前（120/60/IP/路由）；高危接口用 `@RateLimit({limit,window,by})` 单独收紧
- 上传只允许位图（png/jpg/gif/webp/bmp），必须过 `detectImageSignature` 文件头校验；禁 SVG
- 多步写必须 `manager.transaction`，事务内一律 `manager.getRepository()`（默认连接看不到未提交数据）
- 唯一键写入前必须前置查重（含软删占用）+ 捕获 ER_DUP_ENTRY 转 400（`utils/db-error.util.ts`）
- 业务异常优先 `BadRequestException`（HTTP 400）而非 500；限流 429 / 锁定 1009

## 接口契约与密码算法（2026-11-06 二期）

- 新接口只挂 `/api/v1/**`；旧版无前缀路由默认不注册（`LEGACY_ROUTES_ENABLED=true` 才开）。下线前先核 v1 是否覆盖旧路由全部能力
- 列表查询一律返回 `Pagination`（records/total/current/size/pages），新增列表用 `toPagination()`；数据源类（tree/options/code）才返回数组
- 密码：新数据 Argon2id（`@node-rs/argon2`，m=19456/t=2/p=1，约 18ms），历史 jeecg 格式在登录成功后就地升级；`UserService.verifyPassword` 是**异步**的，调用要 await
- 权限集合走 `PermissionCacheService`（按角色缓存）；任何改动 role_permission / sys_permission 的写路径都要调用 invalidateRole / invalidateAll

## 业务错误码（2026-11-10 起，新接口照此办理）

- 枚举 `src/common/enums/biz-error-code.enum.ts` 已分段：**冻结段**（0 / 41x / 1001~1009 / 429 / 503，**只增不改**，前端与冒烟都在断言）+ 21xx 认证 / 31xx 角色 / 41xx 组织 / 51xx 配置 / 61xx 文件导入 / 71xx 协作 / 81xx 租户 / 91xx 运维
- **加码铁律：一码一消费者**——新增前必须写明谁在用它分支（前端 UI / 监控聚合 / 重试策略）；同类细节靠 message 区分（导入缺哪列都算 6103），否则就是造死码（414/415/416 就是这么来的，已删）
- 抛业务错用 `BizException(BizErrorCode.X, '人话文案', 可选HttpStatus)`；**能按 code 分支就别解析 message 文本**（文案随时会改）
- 过滤器规则：BizException 用枚举码 / 已知 HttpException 查映射表 / **未映射 4xx 用 status 本身** / 仅 5xx 回落 1006
- 前端 `ApiError` 已有 `code?: number`，`http.ts` 已透传 `json.code`；401 有两道判定：`res.status === 401`（必须在 `parseJsonBody` 之前，401 响应体可能不是 JSON）+ `json.code === 401`（**被 `tests/http-unauthorized.test.cjs` 锁定的兼容分支，HTTP 200 + code 401 的网关场景，别删**）
- `/v1/files/purge` 的 `ids` 必须是**字符串数组**（传 number 报 1001）；冒烟脚本调用后必须检查 `code`，否则静默失败

## 页面水印（2026-11-06 三期）

- 模块 `src/modules/system/watermark/`：全局 `sys_watermark_setting`（单行）+ `sys_user_watermark`（NULL=继承）；生效规则唯一入口 `resolveWatermarkState`（off > enforced=2 > enforced=1 > forced > 用户??全局），别在别处重写判定
- 用户侧接口只允许 enabled/content/density，样式参数（opacity/rotate/fontSize）只能全局改——防止用户把水印调透明绕过；占位符由服务端渲染成 lines 下发
- 坑：`PUT /v1/users/me/watermark` 必须声明在 `PUT /v1/users/:id/watermark` 之前；新表建表要显式 `COLLATE=utf8mb4_unicode_ci`（sys_user 是 unicode_ci，默认 0900_ai_ci JOIN 会炸）；删用户事务里要同步删水印行

## 首页概览（2026-11-07）

- 单接口 `GET /api/v1/dashboard/overview`（`src/modules/dashboard/`，**不挂 @Perms**，登录即可访问，裁剪在 service 内部）。契约铁律：**没权限的块返回 `null`，不是 0**；降级块带 `scope: 'all' | 'self'`
- 裁剪三层：块级（按钮权限）→ 行级（`sys_role.data_scope`，走 `UserService.countScoped`）→ 归属级（`owner_id` / `assignee_id`）
- 降级规则：登录趋势 / 今日登录 / 最近操作无全站权限时自动降级为「我自己的」；用户总数/在线/角色/系统状态无权限就隐藏
- 前端只判 null 不判权限（localStorage 可篡改）；卡片的权限门槛必须等于目标页门槛（见 `quick-entries-card.tsx` 的 `ENTRIES`）
- 首页是**常驻页面**：`/dashboard` 在 `lib/permissions.ts` 的 `ALWAYS_ALLOWED` 里，`resolveHomePath()` 恒返回首页（旧的「按注册表找第一个有权限页面」兜底已删）；侧边栏入口走**动态菜单**——`AuthService.getPermissions()` 末尾 `withHomeMenu()` 会把 `sys_permission` 里的 `/dashboard` 节点补到树顶（超管/按角色两个分支都过），前端 `app-sidebar.tsx` 不再有硬编码入口，另对 localStorage 老菜单树做兜底注入
- 顺带修：`applyDataScope` 原来漏了 `data_scope=1（全部）` 档，导致「有 system:user:list 但没挂部门」的账号 `1 = 0` 看不到任何用户（审计员用户列表为空就是这个）。现在 `scope === ALL` 直接 return 不过滤
- 已知遗留：`task.assignee_id` 是 `int`，`sys_user.id` 是 `varchar(32)`，两边永远匹配不上 → 「我的待办」恒为 0（只统计 `assignee_id = 0` 未指派）；彻底修需把该列迁成 varchar
- 冒烟：`scripts/smoke-dashboard.mjs`（60 项，admin/viewer/auditor/无角色 四类账号，临时账号自动清理），需 `PORT=3461 CAPTCHA_ENABLED=false` 的测试实例

## 多租户（2026-11-07，88caa2c）

- 表：`sys_tenant` + `sys_user_tenant`（多对多）+ `sys_user.login_tenant_id`；9 张核心业务表 `tenant_id INT NOT NULL DEFAULT 1`，**`0` = 平台共享数据（所有租户可见）**
- 隔离规则唯一入口 `src/shared/tenant/tenant-scope.util.ts`：`null` 不过滤（超管平台视角）/ `0` 只看共享 / `>0` 本租户 + 共享。别在 service 里手写判定
- 上下文必须由**全局中间件** `TenantContext.run(store, next)` 建立（Guard 里 set 无效）；`BaseService` 对带 `tenantId` 的实体自动读写隔离，手写 QueryBuilder 的 service 需自己 `applyTenantScope(qb, alias)`（用 `andWhere(new Brackets(...))`，别 `where()` 覆盖）
- 接口 `/api/v1/tenants` 九个：CRUD + `:id/users` 覆盖式分配 + `mine` + `switch`。超管 `mine` 返回**全表租户 + isSuper**，`switch(0)` = 回平台视角（仅超管）
- 前端：顶栏 `TenantSwitcher` 写 localStorage `concise-tenant` → `http.ts` 自动带 `X-Tenant-Id`，切换后整页 reload
- 坑：`@Column({ length })` 可空会被推断成 `Object`（必须显式 `type:'varchar'`）；新表 `COLLATE=utf8mb4_unicode_ci`；`Pagination` 无链式方法
- 冒烟：`scripts/smoke-tenant.mjs`（26 项，需 `PORT=3461 CAPTCHA_ENABLED=false` 实例）

## 租户默认角色模板（2026-11-09，4d383b6）

- 建租户自动生成 admin/editor/viewer 三套角色并授权（同事务），不再出现「空壳租户里管理员也 403」
- 模板在 `modules/system/tenant/tenant-role-template.ts`：admin=`all`+`is_builtin=1`；editor=排除 `delete/batch-delete/clean/reset-password/restore`；viewer 只读白名单 `list/query/detail/export/download`。**判定只看 perms 后缀，无 perms 的页面节点一律给**（只决定可见性）
- `POST /v1/tenants/:id/provision` / `/provision-all` 幂等补齐。**权限落库不跟随菜单演进**：平台新增租户级菜单后必须跑一次 provision-all
- 不能复用 `RoleService.assignMenus`（对 `is_builtin=1` 直接抛错，防止租户改内置角色授权）；初始化直接 `INSERT IGNORE sys_role_permission`
- 冒烟：`scripts/smoke-tenant-provision.mjs`（27 项）

## 界面设置上云（2026-11-07，9549938 / 前端 a7da194）

- 表 `sys_user_setting`：`user_id` 主键 + `settings` TEXT，**故意不建 tenant_id**（偏好跟人走，切租户不该变主题色）。接口 `GET|PUT /api/v1/users/me/settings`，登录即可、不挂 @Perms。
- 服务端白名单唯一入口 `modules/system/user-setting/user-setting.util.ts`：**加新设置项必须同步改这里**，否则静默丢弃。未知键/非法值丢弃不报 400；`themeColor` 只校验格式不锁枚举。
- `save()` 是合并语义 + 4KB 上限；全非法键时返回旧值不写库；`get()` 读出来也过白名单。
- 前端 `lib/settings.ts` 只有两层（本地 ⇄ 云端）：**不要用 `getApiResult`**（401 会踢去登录页），设置必须静默降级；`update()` 必须先写 localStorage 再推云端。
- `SettingsProvider` 在 `__root` 不卸载、登录是 `navigate()`，所以登录后靠 `AUTH_CHANGED_EVENT`（auth.ts login/logout 派发）重新拉云端；登出必须 `clearLocalSettings()`。
- 坑：vite `settingsApi()` 与 `index.html` 内联脚本同用 `#app-settings-override`，前者的静态默认值会静默盖掉用户设置 —— 已删除该插件与 `settings.json`，别再加回来。
- 冒烟：`scripts/smoke-user-setting.mjs`（18 项，需 `PORT=3461 CAPTCHA_ENABLED=false` 实例）。
