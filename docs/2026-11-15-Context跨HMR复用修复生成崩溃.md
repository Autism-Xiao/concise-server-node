# Context 跨 HMR 复用：修复「执行生成」后页面崩溃 + 订单模块落地

## 现象

在「代码生成」页点「执行生成」，生成成功后页面瞬间被路由错误边界接管，显示：

```
Something went wrong!
Error: useTabs must be used within TabsProvider
```

## 根因（无头复现实锤）

- `tabs-provider.tsx` 用原生 `createContext()` 在模块顶层建 Context；Vite HMR 会**重新执行模块**，产出**新的** Context 对象
- 生成器把前端产物写进 `src/`（page-registry / i18n / 路由树），一次写盘连带 HMR 重执行 provider 模块
- 已挂载的 Provider 持有旧 Context，新模块里的 `useTabs()` 读到 null → 抛错 → TanStack Router 默认错误组件（Something went wrong! / Hide Error）接管整页
- 复现方式：页面停在任意页，仅改 `page-registry.ts` 等文件的 mtime（内容不动）触发同一条 HMR 链路，console 里 `at useTabs … at PageTabs` 与线上现象一致

## 修复

1. 新增 `src/lib/hmr-context.ts` 的 `createHmrSafeContext(key, defaultValue)`：Context 实例按静态 key 挂在 `globalThis` 上，模块重执行时取回同一对象，Provider 与 Consumer 永不失联
2. 全部 8 个 context provider 换用该工厂（locale / lock / search / settings / shortcut / tabs / tenant-scope / watermark），key 统一 `concise.context.*`
3. 新增 `tests/context-hmr-safe.test.cjs` 锁约定：任何 context 文件再出现原生 `createContext` 直接红
4. 生成结果卡新增「刷新页面」按钮与提示：前端产物写盘后 HMR 可能停在半热更状态（新增路由需路由树重生成），刷新一次即干净

## 顺手完成：biz_order（订单）模块落地

用户在页面上真实生成的 `biz_order`（订单）产物此前只写了文件没有落地，本次补完流水线：

- 清掉重复生成的迁移（两次生成各产一份，`diff` 确认内容一致仅类名时间戳不同，保留较新一份）
- 后端 `npm run build` 编译通过 → `migration:run` 建表 + 菜单落库 → 重启 3000 服务
- `POST /v1/tenants/provision-all`：3 个租户补 24 条角色授权
- 冒烟：`GET /v1/biz_orders` 200（空列表）；无头浏览器确认「订单管理」页渲染完整（表格列：序号/标题/状态/金额/签约时间/备注/操作）

## 文件清单

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/lib/hmr-context.ts` | 新增 | Context 跨 HMR 复用工厂（globalThis 单例） |
| `src/context/*.tsx` × 8 | 修复 | 全部改用 createHmrSafeContext |
| `tests/context-hmr-safe.test.cjs` | 新增 | 锁定「Context 必须 HMR 安全」约定 |
| `src/features/system/codegen/index.tsx` | 优化 | 生成结果卡加刷新提示与按钮 |
| `src/features/biz_order/**`、`src/routes/_authenticated/system/biz_orders.tsx`、`page-registry` / `i18n` / `routeTree` | 生成产物 | 订单模块（保留用户生成结果） |
| `src/modules/biz_order/**`、`src/migrations/1794744585590-GenBizOrder.ts`、`app.module.ts` | 生成产物 | 后端五件套 + 迁移 |

## 踩的坑

1. **HMR 重执行模块 = 模块级单例失效**：`createContext`、模块级缓存、事件总线这类「模块即单例」的东西在 Vite 下都可能被重新执行；需要跨 HMR 存活的实例必须锚在 `globalThis` 上。
2. HMR 传播链不直观：改 page-registry 的 mtime 就能把 tabs-provider 炸出来（importer 链 + react-refresh 传播），复现时别只盯着报错文件本身。
3. 生成器重复点击会重复产迁移（CREATE TABLE IF NOT EXISTS / INSERT IGNORE 保证执行安全，但迁移表会脏）；后续可在 generate 接口里对同名迁移去重（留作待办）。
4. 生成的 API 路径是模块蛇形（`/v1/biz_orders` 下划线），与既有 kebab 风格（`/v1/users`）不一致——能用但风格不一，生成器后续可统一转 kebab。

## 如何扩展

- 新增 context provider 一律用 `createHmrSafeContext('concise.context.xxx', 默认值)`，key 永不改名（改 key = 换新 Context = 丢状态）
- 测试回归：`npm test` 中的 `context-hmr-safe` 会在任何 provider 退回原生 createContext 时报错并指路
