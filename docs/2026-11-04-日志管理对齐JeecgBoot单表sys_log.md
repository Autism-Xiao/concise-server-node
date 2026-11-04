# 日志管理对齐 JeecgBoot（单表 sys_log）

> 日期：2026-11-04
> 仓库：concise-server-node / concise-admin

## 背景

原设计是 `login_log` + `oper_log` 两张自增主键表。本次对齐 jeecg-boot：合并为**单表 `sys_log`**（`log_type` 区分），主键 32 位字符串，`status` 用 jeecg 语义（**0 正常/成功，1 异常/失败**——与旧表相反）。同时前端日志两页从 mock/半真切换为全真实数据。

## 数据库

- 新建 `sys_log`（collation 与库内既有表一致 utf8mb4_unicode_ci）：jeecg 字段 `job_id/log_content/log_type/operate_type/operate_user_id/operate_user_name/ip/status/cost_time/create_by/create_time` + 项目扩展列 `browser/os/location`（登录）、`params/error_msg`（操作）
- 迁移存量：登录日志 105 条、操作日志 88 条，`status` 取反映射，id 重生成 32 位
- 已 drop `login_log`、`oper_log`

## 后端改动

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/modules/system/log/entities/sys-log.entity.ts` | 新增 | 单表实体（jeecg 结构+扩展列） |
| `src/modules/system/log/log.service.ts` | 重写 | 单表读写；recordLogin/recordOper 输入统一 jeecg status 语义 |
| `src/modules/system/log/log.v1.controller.ts` | 新增 | `/api/v1/logs/**` 八接口（替代旧 log.controller.ts，已删） |
| `src/modules/system/log/log.module.ts` | 修改 | 实体/控制器换新 |
| `src/common/interceptors/oper-log.interceptor.ts` | 修改 | METHOD_OPERATE_TYPE 映射（POST→2 添加/PUT→3 更新/DELETE→4 删除）；status 改 jeecg 语义 |
| `src/modules/auth/services/auth.service.ts` | 修改 | recordLogin 调用点 status 语义对齐 |
| `src/migrations/1793786906437-Migration.ts` | 新增 | 建表+迁移存量+删旧表 |

### 接口清单（V1）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/logs/login` | 登录日志分页（username/status/startTime/endTime 过滤） |
| GET | `/api/v1/logs/login/export` | 导出登录日志 CSV |
| GET | `/api/v1/logs/login/:id` | 登录日志详情 |
| DELETE | `/api/v1/logs/login` | 批量删除（body `{ids: string[]}`） |
| GET | `/api/v1/logs/oper` | 操作日志分页（username/module/时间过滤） |
| GET | `/api/v1/logs/oper/export` | 导出操作日志 CSV |
| GET | `/api/v1/logs/oper/:id` | 操作日志详情 |
| DELETE | `/api/v1/logs/oper` | 批量删除 |

响应字段（jeecg）：`logContent`（登录=结果说明；操作=`模块 - 方法 路径`）、`logType`、`operateType`、`operateUserName`、`status`（0 成功 1 失败）、`costTime`、`browser/os/location`、`params/errorMsg`、`createTime`

## 前端改动（concise-admin）

| 文件 | 说明 |
|---|---|
| `src/features/system/log/api.ts` | 重写：两页都走 `/api/v1/logs`；`withOperationLog` 改纯透传（后端拦截器已统一记录）；删除 reportOperation 假上报 |
| `src/features/system/log/components/log-table-page.tsx` | id 改 string；新增 `deleteKind` prop；单条删除/清空对接真实批量删除接口 |
| `login.tsx` / `operation.tsx` | 传 deleteKind |

## 验证

- 迁移后：登录 105 条 / 操作 88 条，status 映射正确（成功=0）
- 写入登录日志（UA 解析 browser/os/location 正常）、写入操作日志（operateType/costTime/errorMsg 正常）、模块过滤、批量删除均通过
- 前后端 tsc/eslint 全绿

## 踩坑

- **TypeORM 列类型反射**：`browser?: string | null` 联合类型会被 reflect-metadata 推断成 Object 导致 `DataTypeNotSupportedError`，实体可选列写 `?: string` 即可（与 dept 实体一致）
- jeecg 的 status 语义（0 成功 1 失败）与直觉相反，迁移取反 `1 - status`，前后端注释都标注了
- `bigint` 的 `costTime` 查询返回是字符串（mysql2 驱动特性），前端要 `Number()` 转换
