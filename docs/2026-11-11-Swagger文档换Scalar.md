# 2026-11-11 Swagger 文档 UI 换 Scalar

## 改了什么

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/main.ts` | 修改 | Swagger 接入区段重写：`/api/docs` 主入口换成 Scalar（`@scalar/nestjs-api-reference`），原版 swagger-ui 挪到 `/api/docs-ui` 作备用，`/api/docs-json` 契约地址显式钉住不变 |
| `package.json` / `pnpm-lock.yaml` | 修改 | 新增依赖 `@scalar/nestjs-api-reference ^1.2.35` |

## 每个东西是干什么的

- **`/api/docs`（Scalar）**：现代化 API 文档 UI——左侧接口树、全局搜索（快捷键）、接口直调、深浅色主题。`theme: 'saturn'`、`layout: 'modern'`，想换风格改这两个字段即可（可选：default/alternate/moon/purple/bluePlanet/deepSpace/saturn/kepler…）。
- **`/api/docs-ui`（swagger-ui 备用）**：纯自托管 UI，不依赖 CDN；内网/断网环境用它。JSON 契约通过 `jsonDocumentUrl` 显式指回 `/api/docs-json`——**不指定会跟着 setup 路径漂移成 `/api/docs-ui-json`**，那会打断所有冒烟脚本。
- **`/api/docs-json`**：OpenAPI JSON，地址不变，冒烟脚本/工具零改动。

## 遇到的坑（这次最大的坑不在代码，在包管理器）

1. **这个项目是 pnpm 管的（有 `pnpm-lock.yaml`、`node_modules/.pnpm` 布局），npm 完全不能用**——`npm install` 直接崩 `Cannot read properties of null (reading 'matches')`（arborist 的 Link 节点处理不了 pnpm 布局），连纯恢复依赖都不行。诊断线索在 npm debug 日志里：`idealTree:node_modules/.pnpm/...`。装包一律 `pnpm add`，恢复一律 `pnpm install --force`（npm 强杀后顶层符号链接缺失时用）。
2. **顶层 `require('express/package.json')` 找不到 ≠ node_modules 坏了**：pnpm 不提升嵌套依赖，express 只在 `@nestjs/platform-express` 内部，属正常表现。判断依赖完整性用 `ls node_modules/.pnpm | wc -l`（本仓 ~1000），别数顶层。
3. **Scalar 的页面标题字段是 `pageTitle` 不是 `title`**（`title` 是 spec 的标题，页头标题走 `pageTitle`），传错字段会静默回落默认「Scalar API Reference」。
4. **Scalar UI 从 jsdelivr CDN 加载**（ESM bundle），浏览器需联网；断网环境用 `/api/docs-ui`。这是包的实现方式（client-side-rendering 渲染单 HTML，脚本引 CDN），不是可配置的自托管项。
5. 内容传 `content: document`（规格内嵌进 HTML，页面约 430KB），不用 `url` 二次请求，避免加载时序问题。

## 怎么扩展/使用

- 换主题：`src/main.ts` 里 `theme: 'saturn'` 换枚举值即可，刷新生效
- 新接口照常写装饰器，两个 UI 与 JSON 自动同步（同一份 `document`）
- 生产环境默认关（`SWAGGER_ENABLED` 开关未动），行为不变
