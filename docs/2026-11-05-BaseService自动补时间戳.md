# 2026-11-05 BaseService 自动补时间戳

## 背景

项目已两次踩到「忘写时间戳」的坑（角色 create、updateRole、assignDepts），根因是 `BaseService.create/update` 不自动补 `createTime`/`updateTime`，全靠各服务手写样板代码。本次在基类收口，一次消除整类问题。

## 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/helper/crud/base.service.ts` | 增强 | `create`：实体有 `createTime` 列且未赋值时自动补 `new Date()`；`update`：实体有 `updateTime` 列且调用方未显式传入时自动补（不改传入对象，用浅拷贝） |

## 行为规则

1. **不传 → 自动补**：`roles.create({ roleName, roleCode })` 落库后 `createTime` 是当前时间；`base.update(id, { description })` 自动带 `updateTime`。
2. **显式传 → 不覆盖**：服务里已有的 `createTime: new Date()`、`updateTime: new Date()` 样板代码全部保持原语义，无需删除，显式值优先。
3. **无该列 → 跳过**：通过 `repository.metadata.findColumnWithPropertyName()` 检测，没有该列的实体（如数字自增主键的日志表如果没这列）不会报错。
4. **绕过基类的调用不受影响**：直接 `repository.update` / QueryBuilder `set()` 的地方（如 `role.updateRole`、`dict` 服务）仍走各自手写的时间戳——上一轮已全部补齐并 grep 确认无遗漏。

## 遇到的坑

- `update` 里最初用 `Object.assign(dto, ...)` 直接改入参对象，调用方复用同一 dto 时会被污染；改成 `{ ...dto, updateTime: new Date() }` 浅拷贝。
- 判断「未传入」用 `=== undefined` 而不是 `!('updateTime' in dto)`：服务显式传 `updateTime: undefined` 的场景也应视为未传入。
- `@CreateDateColumn` 实体（公告）显式传值时 TypeORM 会按显式值插入，语义相同，无冲突；且其 createTime 由手写代码传入，不会走到自动补分支。

## 怎么扩展 / 使用

- **新增模块**：实体只要 `createTime`/`updateTime` 列名是 TypeORM 属性名（驼峰），继承 `BaseService` 后 create/update 无需再手写时间戳；想传特殊值（如导入回填历史时间）显式传即可。
- **直接用 Repository 的地方**（批量更新、QueryBuilder）不经过基类，仍需自己带 `updateTime`。

## 验证记录

- `npx tsc --noEmit` / `npm run build` / `npx jest`（6/6）/ `npx eslint src/helper` 全绿
- 服务层实测（临时脚本，跑完即删）：
  1. `roles.create` 不传 createTime → 自动补 `2026-11-05T02:48:05` ✅
  2. `roles.update` 不传 updateTime → `null → 2026-11-05T02:48:06` ✅
  3. 显式传 `updateTime: 2020-01-01` → 保持 `2020-01-01` 未被覆盖 ✅
- 测试角色 `t_auto_stamp` 已删除
