# API 端口落地页与 favicon 兜底

> 起因：浏览器打开 `http://localhost:3459` 报两条错 —— `net::ERR_CONNECTION_CLOSED`、`favicon.ico 404`，用户误以为服务挂了。

## 一、结论先行：不是服务挂了

| 现象 | 真相 |
| --- | --- |
| `http://localhost:3459/` 打不开 / 404 | 3459 是**纯 JSON API 端口**，本来就没有页面路由 |
| `favicon.ico 404` | API 服务不伺服网站图标，浏览器却会无条件请求一次 |
| `ERR_CONNECTION_CLOSED` | 后端正处于重启窗口（或前端代理没连上后端），旧连接被直接关掉 |

**管理后台页面在 `http://localhost:5173`**（前端 dev server），后端只提供 `/api/**` 接口。
`3459` 的 `PORT` 来自 `concise-server-node/.env`，前端 `vite.config.ts` 的 `resolveBackendPort()` 会自动读它做代理，所以两边端口天然一致。

## 二、改了哪些文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/main.ts` | 修改 | 新增 `registerApiLanding()`，注册两条顶层路由；启动日志改为中文并写明「这里没有页面」 |

### 1. `GET /` —— API 门面

- `SWAGGER_ENABLED` 开启时（开发默认开）：**302 跳到 `/api/docs`**，误打开端口也能直接落到接口文档（Scalar）。
- 文档关闭时（生产默认关）：返回最小 JSON `{ code: 0, message: 'concise-server-node API', result: null, success: true, timestamp }`，**不泄露 `/api/docs` 这个路径的存在**。

### 2. `GET /favicon.ico` —— 204

返回 `204 No Content` + `Cache-Control: public, max-age=86400`，浏览器拿到一次就不再重试，控制台不再刷 404。

真正的站点图标属于前端（`concise-admin/public/favicon.svg`，由 `index.html` 的 `<link rel="icon">` 引用），不在这里。

### 3. 启动日志

```
API 就绪：http://localhost:3459/api（纯接口服务，不提供页面）
管理后台页面不在这个端口，请开前端 dev server（默认 http://localhost:5173）
接口文档：http://localhost:3459/api/docs (Scalar) | swagger-ui: /api/docs-ui
```

## 三、实现要点

```ts
function registerApiLanding(app: NestExpressApplication, globalPrefix: string): void {
  const instance = app.getHttpAdapter().getInstance() as Express
  // ...
}
```

1. **必须用 express 实例注册，不能用 Controller**。`setGlobalPrefix('api')` 只作用于 Nest 控制器路由，`/` 和 `/favicon.ico` 都不能带前缀，Controller 做不到。
2. **注册顺序必须排在 `helmet()` / `compression()` 之后**。express 中间件按注册顺序执行，先注册的路由在响应时不会经过后面注册的中间件 —— 放前面会丢掉 `X-Content-Type-Options`、`X-Frame-Options`、CSP 等安全头（实测放前面的响应里这些头全空）。
3. 放在 `app.useStaticAssets(public)` **之后**：`/upload/**` 的真实文件优先命中静态中间件，不会被 `/` 路由吃掉。
4. `res.redirect(302, ...)` 用相对路径拼 `/${globalPrefix}/docs`，不硬编码 host，`127.0.0.1` / 局域网 IP / 反代域名都能正确跳。

## 四、实测

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3459/            # 302
curl -s -o /dev/null -w "%{redirect_url}\n" http://127.0.0.1:3459/         # http://127.0.0.1:3459/api/docs
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3459/favicon.ico  # 204
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3459/api/docs     # 200
```

回归确认：`POST /api/v1/auth/login` 仍返回 `417 请先完成滑块验证`（说明登录链路正常、只是缺验证码），`/upload/nope.png` 仍 404，安全头齐全。

## 五、坑

- **别用 Controller 加 `@Controller()` 空路径** 去做根路由：全局前缀会把它变成 `/api`，而且 `favicon.ico` 依旧 404。
- **别把 `/` 做成 HTML 落地页**：纯 API 服务多一份 HTML 就是多一个需要维护、可能被扫的面；302 到已有文档页零成本。
- **favicon 别返回真实图标**：`public/` 目录挂了 `Content-Disposition: attachment`（非位图强制下载），图标放那儿反而更乱；204 是最省的处理。
- **`ERR_CONNECTION_CLOSED` 和 404 是两件事**：前者是连接层（服务没起 / 正在重启），要先看 `netstat -ano | grep 3459`；能拿到 404 说明服务是活的，只是没有那个路由。

## 六、怎么扩展

- 想加别的顶层探测路由（如 `/robots.txt`、`/healthz`）：同样在 `registerApiLanding()` 里 `instance.get(...)`，注意仍要排在 helmet 之后。
- 想让生产环境也暴露文档：`SWAGGER_ENABLED=true`，`/` 会自动变成 302 跳转，无需改代码。
- 想换成静态图标：在 `registerApiLanding` 里改成 `instance.get('/favicon.ico', (_, res) => res.sendFile(path.join(process.cwd(), 'public', 'favicon.ico')))`，并把 `favicon.ico` 加进 `INLINE_EXTENSIONS` 白名单（否则会被强制下载）。
