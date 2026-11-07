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
