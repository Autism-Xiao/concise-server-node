# 前端 dev server 双栈监听（修「项目没起来」）

## 现象

终端里 vite 已打印 `VITE ready`、`Local: http://localhost:5173/`，但浏览器打开 **`http://127.0.0.1:5173`** 报「无法访问此网站」，看起来就是项目没起来。同一时刻 `http://localhost:5173` 是正常的。

## 根因

vite 默认 `server.host` 不设值时，Node 的 `server.listen(port)` 在 Windows 上解析 `localhost` 只拿到 IPv6 的 `::1`，于是**只监听 `[::1]:5173`**：

```
TCP    [::1]:5173    [::]:0    LISTENING    22352
```

`127.0.0.1` 是 IPv4 地址，与 `::1` 是两个不同的套接字，连上去直接 RST（curl 表现为 `000`）。终端打印的 `localhost` 与用户手敲的 `127.0.0.1` 字面不同 = 一边能开一边不能开，且 vite 自己不报任何错，所以极难自查。

## 改法

`vite.config.ts` 显式绑双栈地址 `::`（Node 默认 `ipv6Only=false`，同一套接字同时接受 IPv4 与 IPv6）：

```ts
const FRONTEND_HOST = process.env.FRONTEND_HOST ?? '::'
server: { host: FRONTEND_HOST, port: FRONTEND_PORT, ... }
```

- 需要只对某网卡开放时用 `FRONTEND_HOST=127.0.0.1` 覆盖（此时只监听 IPv4，`localhost` 若解析到 `::1` 会失败，属于有意的单向绑定）
- 启动横幅同时打印 `localhost` 与 `127.0.0.1` 两个地址，用户点哪个都能开

## 文件清单

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `vite.config.ts` | 修改 | 新增 `FRONTEND_HOST`（默认 `'::'`）并接入 `server.host`；启动横幅在双栈模式下多打一行 `127.0.0.1` 地址；注释写清「vite 默认绑 ::1 导致 IPv4 打不开」的因果 |

## 验证

| 检查 | 结果 |
| --- | --- |
| `netstat -ano \| grep :5173` | `0.0.0.0:5173 LISTENING`（双栈，IPv4/IPv6 均可连） |
| `curl http://127.0.0.1:5173/` | **200**（改前 000） |
| `curl http://localhost:5173/` | 200（未回归） |
| `curl http://127.0.0.1:5173/backend-api/v1/codegen/meta` | 401（代理链正常，鉴权生效） |
| 无头浏览器打开 `http://127.0.0.1:5173/login` | 登录卡片完整渲染（账号/密码/记住密码/安全验证/登录按钮） |
| 无头浏览器注入真 token 打开 `/dashboard` | 侧边栏 30+ 菜单渲染、问候语「晚上好，管理员」、权限 `["*"]` |
| `npx tsc --noEmit -p tsconfig.node.json` | exit 0 |

## 怎么扩展

- 需要局域网真机调试：`FRONTEND_HOST=0.0.0.0 pnpm dev`（等价于旧 vite 的 `--host`），启动横幅会打印 Network 地址
- 同一坑的另一个面：**后端探活别用 `127.0.0.1` 判死 vite**。本轮之前就有一次把「127.0.0.1 打不通」误判成 dev server 挂了、多起了一个实例挤到 5174。现在双栈后两种写法都通，但判断服务存活仍应以 `netstat` 的 LISTENING 行 + 任一地址的 HTTP 码为准
- 生产不受影响：构建产物由 Nginx 托管，与 dev server 监听地址无关
