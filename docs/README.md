# 变更记录索引（docs/）

> **强规则**：每轮生成/修改代码后，必须在 `docs/` 下新建一个变更说明文档，命名 `YYYY-MM-DD-主题.md`，
> 内容包含四部分：**改了哪些文件**（表格：文件/类型/说明）、**每个东西是干什么的**、**遇到的坑**、**怎么扩展/使用**。
> 完成后随代码一起提交推送。新记录生成后请同步更新本索引。

## 文档结构约定

- 命名：`YYYY-MM-DD-主题.md`，一天多轮则一天多个文件，主题用简短中文概括
- 四段式正文：改了哪些文件 → 每个东西是干什么的 → 遇到的坑 → 怎么扩展/使用
- 每篇在下方索引表登记一行（分类 / 主题 / 提交哈希）

## 分类索引

### 01 基础设施与工程化

| 日期 | 文档 | 提交 | 一句话说明 |
| --- | --- | --- | --- |
| 2026-11-04 | [数据库层与用户模块](./2026-11-04-数据库层与用户模块.md) | `f269462` | TypeORM + MySQL 接入、迁移工作流、user 模块 CRUD 闭环 |
| 2026-11-04 | [eslint-prettier-husky](./2026-11-04-eslint-prettier-husky.md) | `4db8373` | ESLint 9 flat config + husky pre-commit + lint-staged 工程链 |
| 2026-11-04 | [prettier配置替换](./2026-11-04-prettier配置替换.md) | `773b014` | Prettier 风格定制：单引号/无分号/160 列/无尾逗号/arrowParens avoid |
| 2026-11-04 | [Swagger接口文档](./2026-11-04-Swagger接口文档.md) | `912b3ed` | /api/docs 在线 UI + /api/docs-json，DTO @ApiProperty + Controller @ApiTags 约定 |
| 2026-11-04 | [user表对齐sys_user](./2026-11-04-user表对齐sys_user.md) | `752407a` | 参照 JeecgBoot：表注释、nickname→realname、补 9 字段、软删除 del_flag、多词列名显式映射 |
| 2026-11-04 | [user表替换为JeecgBoot-sys_user](./2026-11-04-user表替换为JeecgBoot-sys_user.md) | `d0c19bb` | 换 sys_user 表（字符串主键+JeecgBoot 密码算法 PBEWithMD5AndDES）+ 全局 snake_case 命名策略 |
| 2026-11-04 | [role-menu-dept对齐JeecgBoot](./2026-11-04-role-menu-dept对齐JeecgBoot.md) | `e838ffe` | role→sys_role、menu→sys_permission、dept→sys_depart；关联表改 sys_user_role/sys_role_permission；org_code 自动生成 |
| 2026-11-04 | [用户部门多对多sys_user_depart](./2026-11-04-用户部门多对多sys_user_depart.md) | `6828aa4` | 废弃 sys_user.dept_id，改 sys_user_depart 多对多；depart_ids/org_code 冗余同步、部门删除保护修正 |
| 2026-11-04 | [接口兼容审计与deptId兼容字段](./2026-11-04-接口兼容审计与deptId兼容字段.md) | `b6595b0` | 65 个接口逐个审计：仅用户相关 9 个只加字段；补 deptId 只读兼容，refresh 返回同构 |
| 2026-11-04 | [统一响应改JeecgBoot-Result格式](./2026-11-04-统一响应改JeecgBoot-Result格式.md) | `bf673d6` | 全局响应改为 `{code,message,result,success,timestamp}`；失败 result=null/success=false；CSV 不包装 |
| 2026-11-04 | [业务错误码与认证v1路由](./2026-11-04-业务错误码与认证v1路由.md) | `80b2162` | BizErrorCode 枚举（412~417/1001~1008）+ BizException 替换旧异常；新增 /api/v1/auth/captcha、/api/v1/auth/login |
| 2026-11-04 | [登录日志信息增强](./2026-11-04-登录日志信息增强.md) | `fdfc53e` | login_log 加 browser/os/location；服务端统一解析（ua-parser-js + ip2region）+ trust proxy；前端删自造日志对接真实接口 |
| 2026-11-04 | [验证码可读性优化](./2026-11-04-验证码可读性优化.md) | 本轮 | noise 3→1、去随机彩色；svg-captcha 传背景强制 color:true 的坑，改后处理统一配色 |

### 02 认证与权限

| 日期 | 文档 | 提交 | 一句话说明 |
| --- | --- | --- | --- |
| 2026-11-04 | [auth模块JWT登录](./2026-11-04-auth模块JWT登录.md) | `889333c` | 双令牌（2h/7d）、bcryptjs、验证码校验入口、登录日志 |
| 2026-11-04 | [RBAC权限体系](./2026-11-04-RBAC权限体系.md) | `52ae21e` | user—role—menu 三级多对多、全局守卫链、菜单树、@Public/@Roles |
| 2026-11-04 | [按钮级权限与日志与部门](./2026-11-04-按钮级权限与日志与部门.md) | `a3ccc51` | @Perms 实时查库、登录/操作日志、部门树（防环+删除保护） |
| 2026-11-04 | [验证码与日志联调与公告任务](./2026-11-04-验证码与日志联调与公告任务.md) | `0454f8a` | svg-captcha、日志时间过滤/批量删除、公告发布流、任务状态机 |

### 03 业务模块

| 日期 | 文档 | 提交 | 一句话说明 |
| --- | --- | --- | --- |
| 2026-11-04 | [字典模块与用户详情](./2026-11-04-字典模块与用户详情.md) | `02ea1ae` | dict-type/dict-item、code 唯一、下拉数据源接口、用户带部门 |

### 04 公共工具接口

| 日期 | 文档 | 提交 | 一句话说明 |
| --- | --- | --- | --- |
| 2026-11-04 | [公共接口图片上传与存储管理](./2026-11-04-公共接口图片上传与存储管理.md) | `a19ba91` | 参照 nest-admin tools 结构：POST /api/upload（multer）+ tool_storage 记录管理 + 静态资源挂载 |

### 05 安全加固与运维

| 日期 | 文档 | 提交 | 一句话说明 |
| --- | --- | --- | --- |
| 2026-11-04 | [验证码Redis与日志导出与菜单权限录入](./2026-11-04-验证码Redis与日志导出与菜单权限录入.md) | `fb9fcc1` | 验证码接 Redis 多实例、登录/操作日志 CSV 导出、迁移幂等录入菜单按钮权限 |
| 2026-11-04 | [验证码去除内存降级](./2026-11-04-验证码去除内存降级.md) | `f2d5e6b` | 验证码改 Redis 单一模式，未启用时 fail-loud 抛业务错误 |

## 快速导航

- 新人上手建议阅读顺序：数据库层 → 工程化 → auth/RBAC → 各业务模块 → 工具接口
- 排查历史坑：每篇的「遇到的坑」段落可直接搜索关键词（如 snake_case、EADDRINUSE、ParseIntPipe 路由顺序）
- 数据库现状以 `src/migrations/` 为准，菜单/按钮权限数据由迁移幂等维护
| 2026-11-04 | [验证码可读性优化](./2026-11-04-验证码可读性优化.md) | `c48adad` | noise 3→1、去随机彩色（svg-captcha 传背景色会强制 color:true 的坑），后处理统一深色字符 |
| 2026-11-04 | [菜单数据补全](./2026-11-04-菜单数据补全.md) | 本轮 | scripts/seed-menus.cjs 幂等灌数：25 条菜单对齐前端真实路由，修正 url 错位、字典停用 |
| 2026-11-04 | [按钮权限与角色授权闭环](./2026-11-04-按钮权限与角色授权闭环.md) | 本轮 | v1 角色授权接口（menu-ids 回显 + menus 全量覆盖）；角色页对接后端；用户/日志页按钮包 hasPermission |
| 2026-11-04 | [侧边栏三级菜单](./2026-11-04-侧边栏三级菜单.md) | 本轮 | 侧边栏 treeToGroups 递归化：日志管理这类二级目录正确折叠展示登录/操作日志 |
