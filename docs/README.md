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
| 2026-11-04 | [用户管理增删改查](./2026-11-04-用户管理增删改查.md) | 本轮 | /api/v1/users 七个接口（复用现有 DTO/Service）；列表补带角色；前端用户页对接真实接口（jeecg 字段、角色/部门多选、密码留空不改） |
| 2026-11-04 | [菜单管理增删改查重构](./2026-11-04-菜单管理增删改查重构.md) | 本轮 | /api/v1/menus；删除改软删+子级保护(1005)+换父防环；前端菜单页对接后端（parentId 组树、类型联动表单） |
| 2026-11-04 | [角色管理V1-CRUD重构](./2026-11-04-角色管理V1-CRUD重构.md) | 本轮 | /api/v1/roles 七接口；roleCode 唯一拦截、内置 admin 保护、有用户绑定拒删+清关联行；补 system:role:* 按钮权限数据 |
| 2026-11-04 | [部门职级岗位V1接口](./2026-11-04-部门职级岗位V1接口.md) | 本轮 | /api/v1/depts、/api/v1/levels（新表 sys_level）、/api/v1/posts（新表 sys_position 对齐 jeecg）；collation 必须跟库内既有表一致（unicode_ci）的坑 |
| 2026-11-04 | [日志管理对齐JeecgBoot单表sys_log](./2026-11-04-日志管理对齐JeecgBoot单表sys_log.md) | 本轮 | login_log+oper_log 合并为单表 sys_log（jeecg 结构，status 0成功1失败），存量迁移；/api/v1/logs 八接口；前端日志两页全真实数据、删除/清空对接后端 |
| 2026-11-04 | [通知公告对齐JeecgBoot-sys_announcement](./2026-11-04-通知公告对齐JeecgBoot-sys_announcement.md) | 本轮 | notice 表重建为 sys_announcement（titile/msg_content/send_status 等 jeecg 字段，软删），存量迁移；/api/v1/notices 八接口（发布/撤销/软删保护）；前端公告页对接真实数据 |
| 2026-11-04 | [运维管理四模块对接真实数据](./2026-11-04-运维管理四模块对接真实数据.md) | 本轮 | 定时任务建 sys_quartz_job（jeecg 字段一致）+ cron 动态调度；在线用户走 Redis 会话 + 强制下线黑名单；服务/缓存监控实时采集（jeecg 无表）；/api/v1/jobs、/api/v1/online、/api/v1/monitor；前端 ops 四页对接 |
| 2026-11-04 | [职级岗位示例数据-jeecg职务职级字典](./2026-11-04-职级岗位示例数据-jeecg职务职级字典.md) | 本轮 | scripts/seed-level-post.cjs 幂等灌数：职级 5 条（jeecg position_rank 员工/小组长/部门经理/副总经理 + 总经理）、岗位 5 条（挂总公司/研发部）；level_rank 越大越高，与 jeecg 序号同向 |
| 2026-11-04 | [缓存监控前缀分组修复](./2026-11-04-缓存监控前缀分组修复.md) | 本轮 | monitor.service 前缀归属改为「已知前缀最长匹配 + 一级前缀兜底」，修掉 online:session/online:revoked 被合并成 online: 且描述永远显示「业务缓存」的问题 |
| 2026-11-04 | [数据字典对齐JeecgBoot-sys_dict](./2026-11-04-数据字典对齐JeecgBoot-sys_dict.md) | 本轮 | dict_type/dict_item 重建为 sys_dict/sys_dict_item（jeecg 字段，存量迁移+drop 旧表）；合并为 dict 模块，/api/v1/dicts 与 /api/v1/dict-items 十接口；前端字典页改左右分栏并接真实数据；menu_14 启用 |
| 2026-11-04 | [角色管理导入导出接口](./2026-11-04-角色管理导入导出接口.md) | 本轮 | 新增 CSV 导出/导入/模板三接口（`/api/v1/roles/export`、`/import-template`、`/import`），按 roleCode 幂等新增或更新且不动菜单授权；csv.util 补 parseCsv；按钮权限 menu_67/68；前端角色页加导入导出按钮与导入报告弹窗 |
| 2026-11-04 | [角色导出改为xlsx](./2026-11-04-角色导出改为xlsx.md) | 本轮 | 导出/模板改回真 Excel（exceljs，表头加粗+冻结首行+自动筛选+列宽），导入主吃 .xlsx 兼容 .csv；新增 utils/xlsx.util；顺带修掉新建角色不写 create_time 导致列表与导出「创建时间」为空 |
| 2026-11-04 | [字典项分页pageSize超限修复](./2026-11-04-字典项分页pageSize超限修复.md) | 本轮 | 前端 fetchDictItems 硬编码 pageSize=200 撞上后端 PagerDto @Max(100)，字典右栏空白；改为按 100 条翻页取全量（上限 20 页），返回 DictItem[] |
| 2026-11-04 | [角色批量删除与标签页按需挂载](./2026-11-04-角色批量删除与标签页按需挂载.md) | 本轮 | 前端角色页加勾选批量删除（Promise.allSettled 逐条结算，失败不阻断）；TabPageRenderer 改按需挂载（刷新时只挂当前页，避免多标签同时发请求）；补两处 tests 脚本 |
| 2026-11-05 | [后台扫描问题修复](./2026-11-05-后台扫描问题修复.md) | 本轮 | 修 updateRole/assignDepts 不写 updateTime；user 绑定角色/部门与菜单增删改补 @Perms（种子 menu_69~71）；日志导出 CSV 改 xlsx；删 ESM 加载失败的脚手架 spec，新增 csv.util 单测 6 例，npx jest 转绿 |
| 2026-11-05 | [BaseService自动补时间戳](./2026-11-05-BaseService自动补时间戳.md) | 本轮 | create 自动补 createTime、update 自动补 updateTime（列存在且未显式传入时），显式值优先、无列跳过；存量手写样板保持原语义，绕过基类的直连 repository 调用仍需自带 |
| 2026-11-05 | [退出登录接口](./2026-11-05-退出登录接口.md) | 本轮 | POST /api/v1/auth/logout：accessToken/refreshToken 拉黑（复用 online:revoked 黑名单，TTL=令牌剩余有效期）+ 删在线会话；refreshToken 刷新前过黑名单防续命；前端 logout() 先通知后端再清凭证 |
| 2026-11-05 | [分页字段对齐jeecg-IPage](./2026-11-05-分页字段对齐jeecg-IPage.md) | 本轮 | Pagination 改 records/total/size/current/pages（对齐 MyBatis-Plus IPage），job/user 服务与前端 6 处类型 + 4 个页面同步；外层壳本就已是 jeecg 形态未动 |
| 2026-11-05 | [接口文档只保留V1与系统](./2026-11-05-接口文档只保留V1与系统.md) | 本轮 | 8 个旧版无前缀控制器加 `@ApiExcludeController()`（路由不变、仅隐藏文档），Swagger 只剩 15 个分组：系统 + 全部 V1；坑：docs-json 的 path 带 `/api` 前缀、document.tags 恒为空需遍历 operation.tags |
| 2026-11-05 | [配置命名空间化SQL-Redis-JWT](./2026-11-05-配置命名空间化SQL-Redis-JWT.md) | 本轮 | 新增 redis/jwt/captcha 三个 `registerAs` 命名空间 + `env.validation.ts` 启动期校验（缺密钥/端口非数字直接起不来）；9 个文件改 `@Inject(xxxConfig.KEY)`，`.env` 键名不变；坑：Windows 空环境变量等于删除、dist-doc 跑服务会因 entities 写死 `dist/**` 报 No metadata 假错 |
| 2026-11-05 | [超管角色授权收口](./2026-11-05-超管角色授权收口.md) | 本轮 | 抽 `isSuperRole/hasSuperRole` 统一三处超管判定（auth 汇总 / PermsGuard / RolesGuard）；授权接口对超管 400 拒绝、禁止占用 admin/superadmin 编码；`getMenuIds` 对超管返回全部 69 个菜单 id；前端禁用授权/删除按钮并把"已授权"显示为「全部（内置）」 |
| 2026-11-05 | [菜单授权与接口权限打通](./2026-11-05-菜单授权与接口权限打通.md) | 本轮 | 修「勾了菜单却看不到数据」：11 个 v1 控制器 + tasks 去掉类级 `@Roles('admin')`（它短路了方法级 `@Perms`），查询接口统一用 `system:xxx:list`；权限汇总不再只收按钮节点；前端空菜单树不再回退静态全量菜单；新增 `GET /v1/roles/options` 供跨模块下拉 |
| 2026-11-05 | [前端首页跟随权限](./2026-11-05-前端首页跟随权限.md) | 本轮 | 纯前端：新增 `lib/home-path.ts` 解析落地页（仪表盘 → 注册表顺序里第一个有权限的业务页面），替换 5 处写死的 `/dashboard`（`/`、`/login`、登录成功、标签页固定首页、Logo）；一个业务页面都没授权时渲染「尚未分配功能权限」页而非 403；标签恢复按权限过滤、错误页不占标签位 |
| 2026-11-05 | [验证码暗色主题修复](./2026-11-05-验证码暗色主题修复.md) | 本轮 | 验证码 SVG 原为透明背景+深灰字符，暗色下不可读；后端注入白底 rect（单一来源）、前端容器改 bg-white 兜底；不用 svg-captcha 的 background 参数（会强制彩色字符且 fill 会被后处理覆盖），也不用 CSS invert（对灰阶有效但破坏彩色扩展） |
| 2026-11-05 | [滑块验证码改造](./2026-11-05-滑块验证码改造.md) | 本轮 | svg-captcha → 滑块拼图：后端 jimp 程序化生成背景+拼图条（答案只存 Redis，challenge/ticket 双一次性），新增 POST /auth/captcha/verify 发 ticket，登录改 captchaTicket；前端 rc-slider-captcha 替换输入框；CAPTCHA_DEBUG 废弃；坑：jimp 锁 0.22（1.x ESM 与 CJS 冲突）、bgSize 必须与生成尺寸一致否则 x 要乘缩放比 |
| 2026-11-05 | [用户导入导出与报表样式](./2026-11-05-用户导入导出与报表样式.md) | 本轮 | 新增 GET /v1/users/export、/import-template 与 POST /v1/users/import（按账号新增或更新、部门/角色按名称匹配、行号报真实 Excel 行）；xlsx.util 升级为报表渲染引擎（大标题+副标题、深蓝冻结表头、斑马纹、自适应列宽、状态着色、页脚说明），角色与日志导出同步变好看；坑：模板表头 richText 带 * 导致定位失败、重复的 menu_7/8/9 用户按钮 |
| 2026-11-05 | [操作日志改为同步写入](./2026-11-05-操作日志改为同步写入.md) | 本轮 | 修 @nestjs/observe 的 unfinished span 告警：操作日志拦截器把 tap + void 的 fire-and-forget 改成 concatMap 等落库，失败分支 catchError 记日志后用 throwError(() => error) 重抛原异常；顺带用 resolveErrorMessage 从 getResponse() 取业务文案，失败日志不再只有 Bad Request Exception；代价是写接口多一次 INSERT（约 1~5ms） |
| 2026-11-05 | [下载中文文件名与导入冲突提示](./2026-11-05-下载中文文件名与导入冲突提示.md) | 本轮 | 六个下载接口统一中文文件名（新增 utils/download.util.ts 的 setDownloadHeaders，filename* + encodeURIComponent）；用户导入加手机号/邮箱/工号唯一键预检（含软删账号占用），Duplicate entry 翻译成中文；角色模板升级为说明+示例双表、导入按真实 Excel 行号报错；滑块拼图块改为方块+凸起+凹槽的经典形状；坑：唯一索引不释放软删记录、richText 表头带 * 导致定位失败 |
| 2026-11-05 | [通知公告导入接口](./2026-11-05-通知公告导入接口.md) | 本轮 | 新增 GET /v1/notices/import-template 与 POST /v1/notices/import（标题命中即更新、只覆盖填了值的列、指定用户按账号/姓名解析、状态切已发布自动补发布人与时间、行号对齐 Excel）；按“只做导入”删掉临时的导出接口与 menu_77 权限；前端公告页加导入按钮与导入报告弹窗 |
| 2026-11-07 | [区划管理树形懒加载](./2026-11-07-区划管理树形懒加载.md) | 本轮 | 区划页从 DataTable 平铺改成懒加载树（4.5 万行、全量 JSON 12 MB，不能一次性拉）；后端新增 `GET /v1/regions/stats`（group by 层级，须声明在 `:id` 之前）；前端 childMap 缓存 + 展开省级/收起全部 + 搜索仍平铺 + 静默刷新保展开；坑：东莞/中山等 77 条跳级数据不能按 level 差值推断可展开、expanded 不能进 loadTree 依赖 |
| 2026-11-07 | [文件管理落地](./2026-11-07-文件管理落地.md) | 本轮 | 文件管理从 mock 切到真实接口：新增 sys_file（parent_id 目录树 + 软删 + 星标）与 /v1/files 全套接口（列表/面包屑/统计/新建文件夹/上传/下载/改名移动/软删/回收站/彻底删）；物理文件按 sha256 内容寻址放 storage/files（**不放 public**，避免上传 HTML 同源执行）；前端加面包屑逐层进入、拖拽上传带进度、重命名；顺带修 37 条按钮权限 status 为 NULL 导致非 admin 永不生效；冒烟 24/24；坑：multer 需显式装、中文名 latin1、大文件必须 diskStorage、env 常量时序、BIGINT 返回字符串 |
| 2026-11-07 | [启动端口占用自动清理](./2026-11-07-启动端口占用自动清理.md) | 本轮 | 修「每次启动都 EADDRINUSE」：新增 `scripts/serve.mjs`，启动前用 bind 探测端口、netstat 取 PID、按命令行判定是否本项目实例后 `taskkill /T /F`，非本项目占用直接报错不误杀；`start:prod` 改指向它并新增 `restart`；`main.ts` 把裸 `void bootstrap()` 换成带 catch，端口冲突给三行人话提示；坑：PowerShell `$PID` 插值、lsof 无结果退出码 1、taskkill 需 /T 杀 npm 父子链 |
| 2026-11-07 | [文件管理优化二期](./2026-11-07-文件管理优化二期.md) | 本轮 | 修「磁盘只增不减」：覆盖上传漏的旧物理文件按引用计数清盘、新增 FileCleaner 每日清超期回收站（FILE_RECYCLE_DAYS）与残留 tmp（FILE_TMP_HOURS）、恢复时同目录重名自动改名、配额改「精确增量前置 + 写库后二次核并撤销」；下载支持 Range（206/416），新增 `/:id/preview` 只放行位图/PDF/纯文本且按文件头验真（SVG 不放行）；前端补回收站视图（恢复/彻底删除）、移动到…、在线预览；冒烟 24 → 39 项全通过；坑：覆盖的配额增量要减旧大小、assertQuotaAfterWrite 不能用于覆盖分支、PDF 不设 CSP、`bytes=-500` 是最后 N 字节 |
| 2026-11-07 | [首页真实数据改造](./2026-11-07-首页真实数据改造.md) | 本轮 | 首页从 `/mock/dashboard.json`（收入/访客/文档三套模板语义）换成真实数据：新增 `GET /v1/dashboard/overview` 单接口聚合（用户数/今日登录/在线/角色/7 天登录趋势/最近操作/存储/待办/公告/服务器状态），**按权限逐块裁剪**（没权限返回 null 而非 0）并支持「全站→仅我的」降级；顺带修 `applyDataScope` 漏 `data_scope=1(全部)` 档导致「有 user:list 的账号看不到任何用户」、首页改常驻页面（`/dashboard` 进白名单 + `resolveHomePath` 恒返回首页 + 侧边栏固定入口）；冒烟 60/60（admin/viewer/auditor/无角色 四类账号）；坑：null≠0、task.assignee_id 是 int 与 varchar(32) 主键对不上、趋势要按天补零、restart 可能被 safe-delete 拦成"假重启"、serve 命令不能接管道 |
| 2026-11-07 | [确认弹窗通用化与侧边栏去重](./2026-11-07-确认弹窗通用化与侧边栏去重.md) | 本轮 | 修两处 UI 语义错位：① 侧边栏出现两个「仪表盘」（固定入口 + 菜单树 `menu_35`），菜单树渲染时统一剔除 `HOME_PATH`；② 强退/冻结/清理/恢复的确认弹窗按钮硬编码「删除」，把 `ConfirmDeleteDialog` 升级为通用 `ConfirmDialog`（`confirmText` / `confirmVariant` / `loading`），17 个调用点迁移、10 类场景文案与配色逐一对照，正向操作改主色；坑：JSX 块边界不能用 `/>` 判断（`</>` 也含）、批量插文案会误判「清理缓存」描述里的"删除" |
| 2026-11-07 | [首页入口改回动态菜单](./2026-11-07-首页入口改回动态菜单.md) | 本轮 | 反向修上一轮的「固定入口」方案：侧边栏删掉顶部硬编码的「仪表盘」（原来落在搜索上方），`/dashboard` 改为由后端菜单树渲染；后端 `getPermissions()` 新增 `withHomeMenu()`，超管与按角色两个分支都把菜单表里的首页节点补到树顶（新建角色不勾也有入口）；前端 `visible()` / 静态回退分支去掉对 `HOME_PATH` 的剔除，并对老会话的 localStorage 菜单树加兜底注入；坑：两处过滤要一起清、localStorage 菜单树只在登录时写入、oxlint no-misused-spread 在数组字面量里 inline disable 不生效、`npm run restart` 的 build 会被 safe-delete 拦 |
| 2026-11-07 | [首页布局与快捷入口权限收口](./2026-11-07-首页布局与快捷入口权限收口.md) | 本轮 | 访客实测三问题：① 欢迎条右侧大片留白 → 右列补「今天」块 + 整体垂直居中；② 卡片头部标题与「任务看板→」断成两行 → 根因是新 CardHeader 是 grid 容器、flex 类无效，改用 CardAction 插槽，箭头统一 → 换 ›；③ 快捷入口对访客显示「文件管理」→ 过滤从「仅按钮权限」改为「按钮权限 + isPathAllowed 菜单范围」双重门槛，卡片跳转按钮（通知公告/任务看板/操作日志）同源收口；坑：grid 上写 flex-row 静默失效、perm:null ≠ 页面已授权 |
| 2026-11-07 | [角色管理状态开关](./2026-11-07-角色管理状态开关.md) | 本轮 | 对齐 jeecg：角色列表加「状态」Switch 列（乐观更新+失败回滚+ref 防连点）、角色名称/权限字符换序；sys_role 加 status 列，「停用」语义贯通三处——options 下拉不可选、jwt.strategy 裁剪 req.user.roles（@Roles 立即失效）、getPermissions 剔除（侧边栏即时消失）；内置 admin 禁止停用（前后端双保险）；坑：useCallback+useRef 解 exhaustive-deps、3459 验证码挡脚本联调 |
| 2026-11-07 | [状态 Tag 呼吸灯](./2026-11-07-状态Tag呼吸灯.md) | 本轮 | 状态标签统一前置状态圆点；新增 `pulse` 参数与 `status-breathe` 动画（2.4s 明暗、非 animate-ping 雷达圈、reduced-motion 静止）。规则：只有「活的」状态（定时任务运行中 / 任务进行中）呼吸，静态配置态（正常/停用/启用/已发布）一律不闪，否则列表整屏闪烁；光晕用 `bg-current` 继承标签色；截图自查深浅两主题 |
| 2026-11-07 | [首页欢迎条视觉优化](./2026-11-07-首页欢迎条视觉优化.md) | 本轮 | 深色主题下右侧迷你统计「图标+小字+小数字」挤成一团 → 改为竖分隔线分块 + `bg-primary/10` 图标底座 + `text-lg` 大数字（标签移到数字下方），头像加描边；纯展示层调整，WelcomeStat 结构与权限过滤不动；坑：CardContent 基础类 flex-col 必须显式 flex-row、刷新按钮 ml-3 要按统计组是否存在条件加 |
| 2026-11-07 | [菜单管理对齐Jeecg](./2026-11-07-菜单管理对齐Jeecg.md) | 本轮 | 按 jeecg 截图重做菜单管理：列表补组件路径/创建时间列与文本操作钮、搜索行+新增/查询全部 Tab；表单弹窗补「打开方式（组件/内链/外链）」与「权限节点」穿梭框（`PUT /v1/menus/:id/perm-nodes` 全量替换：事务内新增/保留/软删按钮子级）；侧边栏外链新窗口、内链走 `/iframe?url=` 承载页；冒烟 14/14；坑：穿梭框右栏必须用既有按钮回显否则全量替换误删、主键拼接超 32 位、iframe 页要进 ALWAYS_ALLOWED 白名单且协议白名单防 javascript: |
| 2026-11-07 | [部门管理对齐Jeecg](./2026-11-07-部门管理对齐Jeecg.md) | 本轮 | 按 jeecg 截图重做部门管理：列表补部门类型(tag)/状态/备注/创建/更新时间列与文本操作钮；弹窗两栏重排（部门编码可手编/部门类型/状态/备注），状态在用户表单贯通（停用部门不可新选、已挂回显可摘除）；后端 orgCode 手编前置查重（500→400）+ 只在换父级时重算编码；冒烟 9/9；坑：同父级拖拽也会触发换码冲掉手编编码、拖拽 walk 拷字段不全冲掉新列、sys_depart.delFlag 是 varchar |
| 2026-11-07 | [用户管理补职级部门列](./2026-11-07-用户管理补职级部门列.md) | 本轮 | 用户列表对齐 jeecg 演示：角色/岗位/状态已有，补「职级、部门」两列 —— sys_user 加 `level_id` 单列（迁移幂等）+ `resolveLevelId`（空串归 null + 存在性 400）+ `attachLevel` 批量组装，前端列表加列 + 表单职级下拉（停用职级不给新选但保留老值回显）；`scripts/seed-user-demo-org.cjs` 幂等灌数：总经理助理（rank 顺延）、算法/软件/网络工程师三岗、南山区/罗湖区研发中心两部门，顺带清 108 条 smoke_ 冒烟残留部门；坑：QueryRunner 无 hasIndex、org_code 被历史部门占用、被自己占用不算冲突 |
| 2026-11-07 | [界面设置上云与本地兜底](./2026-11-07-界面设置上云与本地兜底.md) | 本轮 | 设置页（字号/主题色/布局/方向/灰度）从「只有 dev 能存 settings.json」改为按用户存 `sys_user_setting`（`user_id` 主键，**故意不建 tenant_id**——偏好跟人走不跟租户走），新增 `GET|PUT /v1/users/me/settings`（白名单裁剪 + 合并语义 + 4KB 上限，登录即可访问不挂 @Perms）；前端 `lib/settings.ts` 收敛为「本地 ⇄ 云端」两层，`update()` 先写 localStorage 再防抖 400ms 推云端，失败降级 `syncState='local'` 并在设置页显示「已保存在本机 + 重试」；首帧靠 `index.html` 内联脚本读 `concise-settings-css` 注入，登出清偏好；顺手删掉 vite 的 `settingsApi()` 与 `settings.json`（它与内联脚本同用 `#app-settings-override` 导致前者被静默盖掉）；冒烟 18/18；坑：同 id style 冲突、`getApiResult` 401 会把人踢去登录页、加载完成前的用户改动不能被云端覆盖、迁移要手动跑 |
| 2026-11-07 | [多租户](./2026-11-07-多租户.md) | 本轮 | 按 jeecg 建 `sys_tenant`+`sys_user_tenant`（用户多对多可切换），9 张核心业务表加 `tenant_id`；AsyncLocalStorage 做请求级租户上下文（中间件 `run()` 包住整链，Guard 里设置无效），`BaseService` 对带 `tenantId` 的实体自动读写隔离，12 个手写 QueryBuilder 的 service 补 `applyTenantScope`；9 个接口（CRUD/分配用户/mine/switch）+ 前端租户页接真实接口 + 顶栏切换器（超管多「平台视角」）；冒烟 26/26；坑：`@Column({length})` 可空推断成 Object、`switch(0)` 被静默吃掉、超管登进去只有一个租户、新表 COLLATE 必须 unicode_ci |
| 2026-11-07 | [登录锁定提示与锁屏记住密码与水印权限](./2026-11-07-登录锁定提示与锁屏记住密码与水印权限.md) | 本轮 | 密码错误提示「还可尝试 N 次」、第 5 次 429 + 锁定 1 天（`ACCOUNT_LOCKED`，管理员 `DELETE /users/:id/lock` 提前解锁）；锁屏页按当前账号读「记住密码」自动填充（抽 `lib/remember`，不自动解锁）+ autocomplete；水印收紧为超管专属：`PUT /users/me/watermark` 非超管 403、`resolve.editable=false`，设置侧边栏入口按 `system:watermark:edit` 显示，逐人开关仍走用户管理；冒烟 22/22；坑：`verify-password` 不能用 401（前端会踢登录态）、`formatLockDuration(86400)` 输出「1 天」不是「24 小时」、锁定文案必须常驻而非只 toast |
| 2026-11-07 | [接口错误提示人性化与端口防呆](./2026-11-07-接口错误提示人性化与端口防呆.md) | 本轮 | 前端（concise-admin）：把「没有收到后端响应（HTTP 502）…请确认 vite 代理 BACKEND_URL 指向正确端口」这类天书换成两轨提示——用户只看「服务暂时连不上，请稍后重试」+ 顶部常驻横幅（合并每个接口各弹一条 toast 的噪音，带「重新连接」），技术细节进控制台 `[接口不可用]`；新增 `lib/api-error.ts` 作为文案唯一出口（`kind` 分支 + `import.meta.env.DEV` 才附细节）；`http.request` 统一 20s 超时与断网；`parseJsonBody` 把「返回 index.html（代理没生效）」也判为服务不可用；vite 启动打印「请访问 → localhost:实到端口」并在端口被占自动切换时告警，代理失败在终端直说该启动后端；单测 7/7（含 HTML 兜底、业务文案透传、横幅状态翻转）；坑：`import.meta.env.DEV` 在测试 CJS 沙箱是语法错误要字符串替换、跨 `vm` 对象不能 deepStrictEqual、代理日志要节流 |
