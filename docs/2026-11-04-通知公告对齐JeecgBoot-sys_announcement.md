# 通知公告对齐 JeecgBoot（sys_announcement）+ V1 接口

> 日期：2026-11-04
> 范围：后端 `concise-server-node`（表结构 + 接口）、前端 `concise-admin`（通知公告页对接真实数据）

## 一、改了哪些文件

### 后端

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/modules/system/notice/entities/sys-announcement.entity.ts` | 新增 | `sys_announcement` 实体（jeecg 字段，列名映射 + 语义化属性名） |
| `src/modules/system/notice/entities/notice.entity.ts` | 删除 | 旧的自造 `notice` 表实体（自增 int 主键） |
| `src/migrations/1793788036198-Migration.ts` | 新增 | 建 `sys_announcement`、迁移旧 `notice` 数据、drop 旧表 |
| `src/modules/system/notice/dto/create-notice.dto.ts` | 重写 | 字段对齐 jeecg（msgCategory / msgType / priority / sendStatus / startTime / endTime / userIds） |
| `src/modules/system/notice/dto/update-notice.dto.ts` | 不变 | 仍是 `PartialType(CreateNoticeDto)` |
| `src/modules/system/notice/dto/query-notice.dto.ts` | 新增 | 列表查询条件（keyword / msgCategory / sendStatus / priority / 时间范围） |
| `src/modules/system/notice/notice.service.ts` | 重写 | 分页查询、全员已发布列表、创建、更新、发布、撤销、软删 + `patchById` |
| `src/modules/system/notice/notice.v1.controller.ts` | 新增 | `/api/v1/notices` 八个接口 |
| `src/modules/system/notice/notice.controller.ts` | 删除 | 旧的 `/api/notices`（自增 id、硬删）整体下线 |
| `src/modules/system/notice/notice.module.ts` | 修改 | 实体换成 `SysAnnouncementEntity`，控制器换成 `NoticeV1Controller` |

### 前端

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/features/system/notice/api.ts` | 重写 | 由 mock JSON 改为 `/backend-api/v1/notices`，补类型/标签映射/增删改发布撤销方法 |
| `src/features/system/notice/index.tsx` | 重写 | 真实数据 + 状态/类型筛选 + 发布/撤销/删除按钮（按 `hasPermission` 控制） |
| `src/features/system/notice/components/notice-form-dialog.tsx` | 重写 | 字段对齐 jeecg（消息类型/优先级/通告对象/生效时间/内容），异步提交带 pending 态 |
| `src/lib/http.ts` | 修改 | `getApiResult` 不再把 `result === null` 当失败（删除类接口无返回体） |

## 二、数据库为什么改

原来 `notice` 表是自造的：自增 `int` 主键、`type`（1 通知 / 2 公告）、`status`（0 草稿 / 1 已发布）、`published_at`。JeecgBoot 的通知公告是 `sys_announcement`，字段语义差别较大，本次直接对齐，旧表在迁移里 drop。

### 字段映射（旧库 → sys_announcement）

| 旧字段 | 新字段（jeecg） | 映射规则 |
|---|---|---|
| `id` int 自增 | `id` varchar(32) | 迁移时 `REPLACE(UUID(),'-','')`，新建由 BaseService 生成 32 位 |
| `title` | `titile` | **jeecg 原表列名就是这个拼写**，保留不改，实体属性仍叫 `title` |
| `content` | `msg_content` | 直接搬 |
| `type` 1通知/2公告 | `msg_category` | 统一取 `'1'`（通知公告），`msg_type` 取 `'ALL'` |
| `status` 0草稿/1发布 | `send_status` | 1 → `'1'` 已发布，0 → `'0'` 未发布 |
| `published_at` | `send_time` | 直接搬 |
| `created_at` / `updated_at` | `create_time` / `update_time` | 直接搬，并补 `create_by='admin'`、`del_flag='0'` |
| — | `priority` / `start_time` / `end_time` / `sender` / `cancel_time` / `user_ids` | jeecg 原生列，新建，迁移数据取默认值 |

### 语义约定（与 jeecg 一致）

- `send_status`：`'0'` 未发布 / `'1'` 已发布 / `'2'` 已撤销（varchar，不是数字）
- `msg_category`：`'1'` 通知公告 / `'2'` 系统消息
- `msg_type`：`ALL` 全体用户 / `USER` 指定用户（配合 `user_ids`）
- `priority`：`L` 低 / `M` 中 / `H` 高
- `del_flag`：`'0'` 正常 / `'1'` 已删除（删除为软删）
- 表/列排序规则统一 `utf8mb4_unicode_ci`（跟库内其它表一致，避免 JOIN 报 `ER_CANT_AGGREGATE_2COLLATIONS`）

## 三、接口（/api/v1/notices）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/v1/notices/published` | 登录即可 | 已发布 + 生效期内，按 `send_time` 倒序（前台通知中心用） |
| GET | `/api/v1/notices` | `system:notice:list` | 管理端分页，含未发布/已撤销 |
| GET | `/api/v1/notices/:id` | `system:notice:list` | 详情（仅未删除） |
| POST | `/api/v1/notices` | `system:notice:add` | 创建，`sendStatus='1'` 即创建即发布 |
| PUT | `/api/v1/notices/:id` | `system:notice:update` | 更新 |
| PUT | `/api/v1/notices/:id/publish` | `system:notice:publish` | 发布（未发布/已撤销 → 已发布） |
| PUT | `/api/v1/notices/:id/revoke` | `system:notice:publish` | 撤销（仅已发布可撤销） |
| DELETE | `/api/v1/notices/:id` | `system:notice:delete` | 软删（已发布需先撤销） |

### 列表查询参数

`page` / `pageSize`（默认 1 / 10，上限 100）、`keyword`（标题+内容模糊）、`msgCategory`、`sendStatus`、`priority`、`startTime` / `endTime`（按 `create_time` 过滤，ISO 8601）。

### 创建/更新 Body 示例

```json
{
  "title": "系统 V1.0 上线",
  "msgContent": "本次上线包含用户、角色、菜单管理",
  "msgCategory": "1",
  "msgType": "ALL",
  "priority": "M",
  "sendStatus": "0",
  "startTime": "2026-11-01T00:00:00.000Z",
  "endTime": "2026-12-01T00:00:00.000Z"
}
```

响应 `data` 为实体：`id`、`title`、`msgContent`、`msgCategory`、`msgType`、`priority`、`sendStatus`、`sender`、`sendTime`、`cancelTime`、`startTime`、`endTime`、`userIds`、`createBy/createTime/updateBy/updateTime`。

## 四、业务规则

1. **创建即发布**：`sendStatus='1'` 时写 `send_time=now`、`sender=当前登录用户`
2. **更新改状态**：未发布 → 已发布补 `send_time` 并清 `cancel_time`；已发布/已撤销 → 未发布清掉发布痕迹
3. **发布**：已发布状态重复发布会报「该公告已发布，无需重复发布」
4. **撤销**：只有 `send_status='1'` 能撤销，写 `cancel_time`，状态置 `'2'`
5. **删除**：软删 `del_flag='1'`；`send_status='1'` 时拒绝，提示「已发布的公告不能直接删除，请先撤销」
6. **全员列表**：只返回 `send_status='1' AND del_flag='0'`，且 `start_time` 未到或 `end_time` 已过的过滤掉
7. 写操作全部带 `@OperLog('通知公告')`，自动进操作日志（`sys_log`）

## 五、前端

- 列表一次拉 100 条（后端 pageSize 上限），本地做全局搜索 + 状态/类型列筛选，头部显示后端返回的真实 `total`
- 行操作：编辑 / 发布或撤销（二选一，取决于当前状态）/ 删除，全部按 `hasPermission('system:notice:*')` 控制显隐
- 表单：消息类型、优先级、通告对象（选「指定用户」才显示接收人输入）、生效起止时间（`datetime-local`，提交转 ISO）、发布状态（未发布/已发布）
- 前端不再用 `withOperationLog` 假上报，操作日志由后端拦截器统一记录

## 六、踩过的坑

1. **列名拼写**：JeecgBoot 的 `sys_announcement` 标题列就是 `titile`（拼错的历史遗留）。改成 `title` 会与官方表/代码生成器对不上，这里保留列名、实体属性映射 `title`。
2. **TypeORM `update()` 清空不了列**：`repository.update(id, { sendTime: undefined })` 会跳过该字段，传 `null` 又被 TS 类型挡住。撤销/回退需要真的写 `NULL`，所以加了 `patchById()` 用 `createQueryBuilder().update().set(patch)` + `Record<string, unknown>` 绕过类型。
3. **Nest 12 的 `createApplicationContext` 在本地验证脚本里必挂**：报 `TypeError: metatype is not a constructor`，栈里是 `ObserveModule` / `ObserveInstrument` 这类内置 provider，与业务代码无关。本地跑 Service 验证脚本改用 `NestFactory.create(AppModule)` + `app.init()` 即可。
4. **`getApiResult` 把 `result: null` 当失败**：统一响应里删除接口 `data` 为 null，前台会误报「请求失败」。已改为只看 `success/code`，`result` 为 null 视为正常成功（用户管理的删除也因此被修好）。
5. **varchar 状态值**：`send_status` / `msg_category` 是字符串，查询参数 DTO 要用 `@IsIn(['0','1','2'])` 而不是数字校验，否则前端传 `"1"` 会被拦。

## 七、怎么用 / 怎么扩展

- 前台通知中心：调 `GET /api/v1/notices/published?page=1&pageSize=10`，按需带 `msgCategory`；登录用户都能读，不需要额外授权
- 新增字段：在实体加列 → 写迁移 → 在 `CreateNoticeDto` 加校验 → 前端 `Notice` 类型与表单补字段即可（`listByQuery` 按需加过滤条件）
- 字典化：`msgCategory` / `priority` 目前硬编码在 `NOTICE_CATEGORY_LABEL` / `NOTICE_PRIORITY_LABEL`，后续可改成走 `sys_dict` 接口动态取
- 角色授权：菜单 `menu_21`（通知公告）+ 按钮 `menu_22~26`，权限编码 `system:notice:list/add/update/publish/delete` 已在库中，角色页勾选即可生效
