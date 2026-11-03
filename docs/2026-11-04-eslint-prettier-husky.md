# 变更说明：ESLint + Prettier + husky 工程化补齐

> 日期：2026-11-04 ｜ 提交：`（本次）`

## 改了哪些文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `eslint.config.mjs` | 新增 | ESLint 9 flat config：`@eslint/js` recommended + `typescript-eslint` recommended。只管正确性（未使用变量、类型错误等），**风格规则全部交给 Prettier**，两者不打架。`no-explicit-any` 关闭、`no-unused-vars` 忽略 `_` 开头 |
| `.prettierrc` | 修改 | 统一风格：**双引号 + 分号 + 100 列宽 + 单引号尾逗号**（与现有代码一致，避免大面积重排） |
| `.prettierignore` | 新增 | dist/node_modules/coverage/logs/lockfile/md 不参与格式化 |
| `.husky/pre-commit` | 新增 | git 提交前自动执行 `lint-staged` |
| `package.json` | 修改 | ① 新增依赖 eslint / @eslint/js / typescript-eslint / prettier / husky / lint-staged ② `prepare: "husky"`（装依赖自动装钩子）③ `lint-staged` 配置：暂存的 `.ts` 依次跑 `eslint --fix` → `prettier --write` ④ 脚本调整见下 |

## 脚本变化

| 命令 | 作用 |
|---|---|
| `pnpm run lint` | ESLint 检查 src/ 和 test/（原来这条跑的是 oxlint） |
| `pnpm run lint:fix` | ESLint 自动修复 |
| `pnpm run lint:ox` | 保留的 oxlint 检查（作为第二道过滤） |
| `pnpm run format` | Prettier 格式化全项目 |
| `pnpm run format:check` | 只检查不修改（适合 CI） |

## 提交流水线（husky + lint-staged）

```
git commit → pre-commit 钩子 → lint-staged
  → 只对本次暂存的 .ts 文件执行 eslint --fix + prettier --write
  → 有修不动的问题则提交失败，本地先改好
```

好处：只检查改动过的文件，提交速度快；格式不统一的文件会被自动修正后一起进暂存区。

## 验证结果

- ESLint：0 错误 0 警告
- Prettier `format:check`：全部文件符合风格
- oxlint：0 警告 0 错误
- `nest build` + 单测：通过
- pre-commit 钩子：本次提交即真实触发验证 ✅
