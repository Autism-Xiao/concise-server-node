# 数据字典：表对齐 JeecgBoot sys_dict / sys_dict_item + 页面与接口补齐

> 日期：2026-11-04
> 范围：后端（表 + 模块 + 接口）、前端（字典页 + 字典项弹窗）、菜单数据

## 一、改动文件

### 后端 `concise-server-node`

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/migrations/1793791381916-Migration.ts` | 新增 | 建 `sys_dict` / `sys_dict_item`，迁移旧表 `dict_type` / `dict_item` 数据后 drop 旧表（含 down 回滚） |
| `src/modules/system/dict/entities/sys-dict.entity.ts` | 新增 | 字典实体，列名映射 jeecg（`dict_name` / `dict_code` / `del_flag` / `type` / `tenant_id`） |
| `src/modules/system/dict/entities/sys-dict-item.entity.ts` | 新增 | 字典项实体（`dict_id` / `item_text` / `item_value` / `sort_order` / `status`） |
| `src/modules/system/dict/dict.service.ts` | 新增 | 字典 CRUD：编码唯一、软删、有字典项拒删、列表带 `itemCount` |
| `src/modules/system/dict/dict-item.service.ts` | 新增 | 字典项 CRUD：同字典下值唯一、按编码取启用项、硬删 |
| `src/modules/system/dict/dict.v1.controller.ts` | 新增 | `/api/v1/dicts` 五个接口 |
| `src/modules/system/dict/dict-item.v1.controller.ts` | 新增 | `/api/v1/dict-items` 五个接口（含全员可读的 `code/:code`） |
| `src/modules/system/dict/dto/*.dto.ts` | 新增 | 6 个 DTO（创建/更新/查询 × 字典/字典项） |
| `src/modules/system/dict/dict.module.ts` | 新增 | 合并模块（两个 Service 共用一张关联关系，拆开反而要互相 import） |
| `src/modules/system/dict-type/**`、`dict-item/**` | **删除** | 旧的碎片模块（int 自增主键、无 v1 前缀、字段非 jeecg） |
| `src/app.module.ts` | 修改 | `DictTypeModule` + `DictItemModule` → `DictModule` |
| `scripts/seed-menus.cjs` | 修改 | `menu_14` 从停用改为启用，名称改「数据字典」，挂 `system:dict:list` |

### 前端 `concise-admin`

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/features/system/dict/api.ts` | 重写 | 从 mock JSON 换成 `/backend-api/v1/dicts` 与 `/v1/dict-items`；类型对齐 jeecg 字段，导出 `fetchDictItemsByCode` 供下拉框复用 |
| `src/features/system/dict/index.tsx` | 重写 | 左右分栏：左字典类型（搜索 + 选中）、右字典项（搜索 + 状态筛选 + 分页表格 + 增删改） |
| `src/features/system/dict/components/dict-form-dialog.tsx` | 重写 | 字段改为 `dictName` / `dictCode` / `type` / `description`，提交走接口并带 loading |
| `src/features/system/dict/components/dict-item-form-dialog.tsx` | 新增 | 字典项表单：文本 / 值 / 排序 / 状态 / 描述 |

## 二、表结构对照

| 旧表（自造） | 新表（jeecg） | 说明 |
|---|---|---|
| `dict_type.id` int 自增 | `sys_dict.id` varchar(32) | 32 位字符串主键，BaseService 自动生成 |
| `dict_type.name` | `sys_dict.dict_name` | |
| `dict_type.code` | `sys_dict.dict_code` | 唯一索引 `uk_sd_dict_code` |
| `dict_type.remark` | `sys_dict.description` | |
| `dict_type.status`(0禁用/1启用) | — | **jeecg 字典类型没有启用状态列**，只有 `del_flag`；页面不再显示启停 |
| — | `sys_dict.type` | 0 string / 1 number |
| `created_at` / `updated_at` | `create_time` / `update_time` + `create_by` / `update_by` | |
| `dict_item.label` | `sys_dict_item.item_text` | |
| `dict_item.value` | `sys_dict_item.item_value` | 同字典下唯一（Service 校验） |
| `dict_item.dict_type_id` | `sys_dict_item.dict_id` | 关联 `sys_dict.id` |
| `dict_item.sort` | `sys_dict_item.sort_order` | |
| `dict_item.status`(0/1) | `sys_dict_item.status`(1启用/0不启用) | 语义一致，直接搬 |

存量数据：2 个字典（用户性别 `sys_user_gender` / 菜单状态 `sys_menu_status`）+ 5 个字典项已迁移，主键映射为 `dict_1`、`dict_item_1` 这类可读值。旧表已 drop。

## 三、接口清单（全部需 Bearer Token）

### 字典 `/api/v1/dicts`（管理员）

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET | `/api/v1/dicts?keyword=` | 字典列表（**全量不分页**，每项带 `itemCount`） | `system:dict:list` |
| GET | `/api/v1/dicts/:id` | 详情 | `system:dict:list` |
| POST | `/api/v1/dicts` | 创建 | `system:dict:add` |
| PUT | `/api/v1/dicts/:id` | 更新（改 `dictCode` 重新校验唯一） | `system:dict:update` |
| DELETE | `/api/v1/dicts/:id` | 软删（`del_flag=1`），有字典项时拒绝 | `system:dict:delete` |

```json
{ "dictName": "用户性别", "dictCode": "sys_user_gender", "type": 0, "description": "用户性别字典" }
```

### 字典项 `/api/v1/dict-items`

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET | `/api/v1/dict-items/code/:code` | **按编码取启用项，所有登录用户可用**（下拉框数据源） | 仅登录 |
| GET | `/api/v1/dict-items?dictId=&keyword=&status=&page=&pageSize=` | 分页列表（按 `sort_order` 升序） | `system:dict:list` |
| GET | `/api/v1/dict-items/:id` | 详情 | `system:dict:list` |
| POST | `/api/v1/dict-items` | 创建 | `system:dict:add` |
| PUT | `/api/v1/dict-items/:id` | 更新 | `system:dict:update` |
| DELETE | `/api/v1/dict-items/:id` | 硬删（表里没有 `del_flag`） | `system:dict:delete` |

```json
{ "dictId": "dict_1", "itemText": "男", "itemValue": "1", "sortOrder": 1, "status": 1 }
```

按编码取的响应（前端可直接渲染下拉）：

```json
{
  "code": 0,
  "data": {
    "dictId": "dict_1",
    "dictCode": "sys_user_gender",
    "dictName": "用户性别",
    "type": 0,
    "items": [
      { "itemText": "男", "itemValue": "1", "sortOrder": 1, "description": null },
      { "itemText": "女", "itemValue": "2", "sortOrder": 2, "description": null },
      { "itemText": "未知", "itemValue": "0", "sortOrder": 3, "description": null }
    ]
  }
}
```

## 四、前端页面

`/system/dict`（菜单「系统管理 → 数据字典」，已从停用改为启用）：

- 左栏：字典类型列表，显示名称 / 编码 / 字典项数量，支持本地搜索（一次全量拉取后前端过滤）
- 右栏：选中字典的字典项表格，支持文本/值搜索、状态筛选、列显示开关、客户端分页（一次取 200 条）
- 操作：新增字典、编辑字典、删除字典（有字典项会提示）；新增/编辑/删除字典项
- 所有写按钮都包 `hasPermission('system:dict:add' | ':update' | ':delete')`

## 五、业务规则

- 字典编码全局唯一（字母开头，可含数字/下划线/冒号/点/短横线），**软删的记录仍占用唯一索引**，删除后不能用同一编码重建（jeecg 也是这个行为，需要复用请改编码或物理删）
- 字典下还有字典项时拒绝删除，提示「该字典下存在 N 个字典项，请先删除字典项」
- 同一字典下 `itemValue` 唯一，跨字典可重复
- 字典项删除是硬删；字典删除是软删（`del_flag=1`），查询一律过滤
- 写操作均带 `@OperLog`（模块名「数据字典」/「字典项」），自动进操作日志

## 六、验证结果

服务层 10 个用例全过：

```
LIST: 菜单状态(sys_menu_status) items=2 | 用户性别(sys_user_gender) items=3
CREATE: d70fa866... test_dict type=0
DUP_CODE blocked: 字典编码「test_dict」已存在
UPDATE: 测试字典改 description= null      # 空字符串正确落成 NULL
ITEM_CREATE: 选项A a status=1
DUP_VALUE blocked: 该字典下已存在值为「a」的字典项
BY_CODE: 用户性别 男=1,女=2,未知=0
BY_CODE_NOT_FOUND blocked: 字典「not_exists_code」不存在或已删除
DEL_WITH_ITEMS blocked: 该字典下存在 1 个字典项，请先删除字典项
AFTER_DELETE: sys_menu_status,sys_user_gender
```

Swagger `/api/docs-json` 确认 10 个路由全部注册；前后端 tsc / eslint / oxlint 全绿。

## 七、踩坑

1. **软删记录占用唯一索引**：重跑验证脚本时 `字典编码「test_dict」已存在` 报错，因为上一轮软删的记录还在表里。测数据前要先物理删：`DELETE FROM sys_dict WHERE dict_code='test_dict'`。这也是「删除后不能重建同编码」的根因。
2. **`repository.update` 不能把字段置 null**：清空描述必须走 QueryBuilder 的 `.set({ description: null })`，否则 `undefined` 会被跳过、`null` 会直接报错。两个 Service 的 update 都用了 QueryBuilder。
3. **TypeORM 列名必须显式写 `name`**：属性用驼峰（`dictCode`），列名用 jeecg 的下划线（`dict_code`），漏写 `name` 会按属性名建列，直接和既有表对不上。
4. **实体可选列别写 `string | null`**：反射会推出 `Object` 类型报 `DataTypeNotSupportedError`，写 `?: string`。
5. **合并模块要注意 `forFeature`**：`DictItemService` 需要注入 `SysDictEntity` 的 Repository，两个实体必须在同一个 `TypeOrmModule.forFeature([...])` 里注册。

## 八、扩展方式

**给前端下拉框接一个字典**：

```ts
import { fetchDictItemsByCode } from '@/features/system/dict/api'

const { items } = await fetchDictItemsByCode('sys_user_gender')
// items → [{ itemText: '男', itemValue: '1', ... }]
```

**新增字典的标准流程**：页面「新增字典」填名称和编码 → 选中该字典 → 「新增字典项」逐条录入 → 业务代码用编码取值。

**如果要让字典项参与业务校验**（如只允许字典内的值），在业务 Service 里查 `sys_dict_item` 判断即可，不要再复制一份枚举。
