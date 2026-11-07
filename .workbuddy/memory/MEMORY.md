# 项目长期记忆：concise-server-node

## 用户强规则（每次必须遵守）

- **每轮生成/修改代码后，必须在 `docs/` 下新建一个 `.md` 变更说明文档**（命名 `YYYY-MM-DD-主题.md`），内容包含：改了哪些文件（表格：文件/类型/说明）、每个东西是干什么的、遇到的坑、怎么扩展/使用。完成后随代码一起提交推送。

## 项目约定

- **给用户的终端命令要用 PowerShell 5.1 语法**：用户在自己终端里粘贴执行，`&&`/`||`/三元/`??` 都会报「不是有效语句分隔符」。多命令用 `npm run build; if ($?) { npm run start:prod }`，环境变量用 `$env:PORT="3459"`。（我自己用 Bash 工具时仍可用 `&&`）
- **重启后端一律 `npm run restart`**（= `nest build` + `scripts/serve.mjs`，启动前自动结束旧的 `dist/main.js` 实例），**绝不用 `nest start --watch`** —— watch 启动前清 dist（675 文件）会被 safe-delete 钩子拦死（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）。裸跑 `node dist/main.js` 撞端口会 EADDRINUSE，查占用者用 `node scripts/serve.mjs --dry-run`
- NestJS 12 CJS + Jest + oxlint；TypeORM 1.1 + MySQL 8.4（本机服务 `MySQL84`，root/123456，库 `concise_server`）
- 参照 E:\project\demo\nest-admin 演进为中后台架构
- 工程链：ESLint 9 flat config（正确性）+ Prettier（`.prettierrc.js`，用户指定风格：**单引号/无分号/160 列/无尾逗号/arrowParens avoid**）+ oxlint（lint:ox 二道）+ husky pre-commit → lint-staged（staged .ts 跑 eslint --fix + prettier --write）。commit 前不要手动跑 format，钩子会处理。
- 统一响应 `{ code, data, message }`；业务异常 HTTP 200 + code 区分；全局 ValidationPipe（transform + whitelist）
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

## 页面水印（2026-11-06 三期）

- 模块 `src/modules/system/watermark/`：全局 `sys_watermark_setting`（单行）+ `sys_user_watermark`（NULL=继承）；生效规则唯一入口 `resolveWatermarkState`（off > enforced=2 > enforced=1 > forced > 用户??全局），别在别处重写判定
- 用户侧接口只允许 enabled/content/density，样式参数（opacity/rotate/fontSize）只能全局改——防止用户把水印调透明绕过；占位符由服务端渲染成 lines 下发
- 坑：`PUT /v1/users/me/watermark` 必须声明在 `PUT /v1/users/:id/watermark` 之前；新表建表要显式 `COLLATE=utf8mb4_unicode_ci`（sys_user 是 unicode_ci，默认 0900_ai_ci JOIN 会炸）；删用户事务里要同步删水印行
