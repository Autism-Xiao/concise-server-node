# 项目长期记忆：concise-server-node

## 用户强规则（每次必须遵守）

- **每轮生成/修改代码后，必须在 `docs/` 下新建一个 `.md` 变更说明文档**（命名 `YYYY-MM-DD-主题.md`），内容包含：改了哪些文件（表格：文件/类型/说明）、每个东西是干什么的、遇到的坑、怎么扩展/使用。完成后随代码一起提交推送。

## 项目约定

- NestJS 12 CJS + Jest + oxlint；TypeORM 1.1 + MySQL 8.4（本机服务 `MySQL84`，root/123456，库 `concise_server`）
- 参照 E:\project\demo\nest-admin 演进为中后台架构
- 工程链：ESLint 9 flat config（正确性）+ Prettier（`.prettierrc.js`，用户指定风格：**单引号/无分号/160 列/无尾逗号/arrowParens avoid**）+ oxlint（lint:ox 二道）+ husky pre-commit → lint-staged（staged .ts 跑 eslint --fix + prettier --write）。commit 前不要手动跑 format，钩子会处理。
- 统一响应 `{ code, data, message }`；业务异常 HTTP 200 + code 区分；全局 ValidationPipe（transform + whitelist）
- 泛型需 `extends ObjectLiteral`；query 参数 DTO 加 `@Type(() => Number)`；运行命令需 `PATH="/d/projram/nodejs:$PATH"`（Node 24）
- 3000 端口被外部进程占用，本地测试用 `PORT=3457`
- Swagger 文档（912b3ed）：`/api/docs` 在线 UI、`/api/docs-json` OpenAPI JSON。约定：新模块 DTO 加 @ApiProperty、Controller 加 @ApiTags + @ApiOperation；Bearer 方案名 'jwt'。文档规则：每轮改动在 docs/ 生成变更 .md（见下方强规则）。
- 下一步：登录/操作日志已就绪可接前端；可选项：字典模块、登录验证码、用户详情带部门
- RBAC 完成（52ae21e）：user—role—menu 三级多对多（user_roles/role_menus），全局 JwtAuthGuard→RolesGuard（APP_GUARD 顺序注册），@Public()/@Roles() 装饰器，菜单树 GET /menus/tree。角色/菜单/用户模块类级 @Roles('admin')。坑：跨模块注入仓库需 imports 对方模块；TypeORM findOne 同时用 relations+select 会报 distinctAlias 错（用 QueryBuilder addSelect+leftJoinAndSelect 代替）。测试数据：角色 admin/viewer/editor，用户 admin(admin)/guest(无角色，密码 guest123)，菜单 系统管理→用户管理。
- 已完成 auth 模块（889333c）：POST /auth/login、/auth/refresh、GET /auth/profile（JwtAuthGuard）。bcryptjs 哈希（UserService.create/update 自动处理）；jwt.strategy validate() 每次查库核对用户状态；双令牌 accessToken(2h)/refreshToken(7d) 从 .env 读。测试账号 admin/admin123（id=1）。类型坑：expiresIn 需 `StringValue` from 'ms'（@types/ms）。
- 三件套完成（a3ccc51）：① @Perms 按钮级权限（perms.guard.ts 实时查 menu.permission，admin bypass，守卫顺序 Jwt→Roles→Perms）；② 登录日志（AuthService.login 记成败）+ 操作日志（OperLogInterceptor 全局拦截写操作，密码脱敏，@OperLog 声明模块名）；③ 部门模块 system/dept（树+CRUD+防环+删除保护），user 实体加 deptId。日志接口权限用 @Perms 而非 @Roles（auditor 角色 403 验证过）。表：dept/login_log/oper_log、user.deptId。测试数据：auditor1（角色 auditor，仅 system:log:*）。
