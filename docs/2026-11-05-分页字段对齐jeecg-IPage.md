# 2026-11-05 分页字段对齐 jeecg IPage（records/current/size/pages）

## 背景

响应外层壳（`code/message/result/success/timestamp`）此前已对齐 jeecg，但分页内层仍是自定义的 `items/page/pageSize/totalPages`，与 jeecg 的 MyBatis-Plus `IPage` 不一致。按「对齐 jeecg 生态、给第三方用同一套接口」的目标，本轮把分页结构改成 jeecg 原字段。

## 字段对照

| 语义 | 改前 | 改后（jeecg） |
|---|---|---|
| 当前页数据 | `items` | **`records`** |
| 总条数 | `total` | `total`（不变） |
| 当前页码 | `page` | **`current`** |
| 每页条数 | `pageSize` | **`size`** |
| 总页数 | `totalPages` | **`pages`** |

响应示例：

```json
{
  "code": 0,
  "message": "",
  "result": { "records": [{ "id": "..." }], "total": 42, "size": 10, "current": 1, "pages": 5 },
  "success": true,
  "timestamp": 1793847700000
}
```

## 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/helper/paginate/pagination.ts` | 重构 | 字段改名；构造参数同步为 `(records, total, current, size)`，`pages` 由 `ceil(total/size)` 计算 |
| `src/helper/paginate/paginate.ts` | 调整 | 局部变量与构造调用跟随改名 |
| `src/modules/ops/job/job.service.ts` | 调整 | `result.items/page/pageSize` → `records/current/size`（任务列表要合并运行时状态，需重建 Pagination） |
| `src/modules/user/user.service.ts` | 调整 | 4 处 `result.items` → `result.records`（部门填充、角色批量查询） |
| concise-admin `src/features/system/dict/api.ts` | 调整 | `PageResult` 字段改名；翻页取全量用 `pages` 而非 `totalPages` |
| concise-admin `src/features/users/api.ts` | 调整 | `UserListResult` 字段改名 |
| concise-admin `src/features/ops/job/api.ts` | 调整 | `JobPage` 字段改名 |
| concise-admin `src/features/ops/online/api.ts` | 调整 | `OnlinePage` 字段改名 |
| concise-admin `src/features/system/notice/api.ts` | 调整 | `NoticeListResult` 字段改名 |
| concise-admin `src/features/system/log/api.ts` | 调整 | 两处 `{ items: BackendSysLog[] }` → `{ records: ... }` |
| concise-admin `users/index.tsx`、`ops/job/index.tsx`、`ops/online/index.tsx`、`system/notice/index.tsx` | 调整 | `res.items` → `res.records` |

## 每个东西是干什么的

- **只改分页内层**：外层 `code/message/result/success/timestamp` 早已是 jeecg 形态，本轮未动；错误响应由 `AllExceptionsFilter` 产出，形状一致。
- **一处定义、全局生效**：所有列表都走 `Pagination` 类（`paginate()` 或手工 `new Pagination`），改一个类 = 全部接口换形状。
- **前端只改消费点**：`getApiResult` 本来就解包 `result`，不需要动；各 feature 的本地 `XxxPage` 接口改字段名即可。
- **字典选项接口不动**：`GET /dict-items/code/:code` 返回的 `{ items: [...] }` 是选项列表，与分页无关，保持原名（jeecg 同类接口也叫 items）。

## 遇到的坑

1. **不要全局替换 `items`**：后端 `dict-item.service.listByCode` 的 `items` 是字典选项数组、Swagger schema 里的 `items` 是 JSON Schema 关键字，误改会坏。只改 `Pagination` 类与分页消费点。
2. **job 服务重建 Pagination 要一起改参数**：它用 `result.page/pageSize` 传参，只改字段名不改传参会得到 `current/size = undefined`。
3. **前端 `total` 不用改**：分页组件用的是 `total`，与后端同名；只换 `items/totalPages`。
4. **`items` 变量名冲突**：`fetchDictItems` 里局部累加数组也叫 `items`，与 `result.items` 是两个东西，改名时注意别把局部变量也换掉。

## 怎么扩展 / 使用

- **新增列表接口**：`await paginate(qb, { page, pageSize })` 直接返回 jeecg 结构，无需关心字段名。
- **需要二次加工列表数据**（如 job 合并运行时状态）：`new Pagination(newRecords, result.total, result.current, result.size)`。
- **前端新增列表**：定义 `{ records, total, current, size, pages }` 类型，页面取 `res.records`。
- **第三方对接**：直接按 jeecg 文档解析 `result.records / current / size / pages`，与 jeecg-boot 完全同构。

## 验证记录

- 后端 tsc / build / eslint / jest（6/6）全绿；前端 tsc / eslint 全绿
- HTTP 实测 5 个分页接口字段全对：用户 `pages=2`、定时任务 `pages=1`、在线用户 `pages=3`、字典项 `pages=2`、登录日志 `pages=66`，均返回 `[current,pages,records,size,total]`
- 外层壳实测：`code,message,result,success,timestamp`，`message` 为空串，与 jeecg 一致
