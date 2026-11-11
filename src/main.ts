import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import compression from 'compression'
import { ConfigService } from '@nestjs/config'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Express, Request, Response } from 'express'
import { apiReference } from '@scalar/nestjs-api-reference'
import helmet from 'helmet'
import path from 'node:path'
import { statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { AppModule, ObserveInstrument } from './app.module'
import { envBoolean } from './global/env'
import { LoggerService } from './shared/logger/logger.service'

/** 上传目录静态响应头：一律禁止嗅探，非位图强制下载，彻底断掉「上传 HTML 直接打开执行脚本」这条路 */
const STATIC_SAFE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  'Cross-Origin-Resource-Policy': 'cross-origin'
}

/** 允许内联展示的扩展名（其余一律 Content-Disposition: attachment） */
const INLINE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

/**
 * 解析 TRUST_PROXY
 *
 * `trust proxy = true` 会让任何客户端都能用 X-Forwarded-For 伪造来源 IP，
 * 登录日志/操作日志里的 IP 就失去审计价值（实测可伪造成 1.2.3.4）。
 * 因此**默认完全不信**：直连部署用 socket 真实地址；部署在 Nginx 后面时由运维显式配置
 * TRUST_PROXY=loopback, 10.0.0.0/8（或 TRUST_PROXY=2 表示信任 2 跳）。
 *
 * 注意：不要默认取 'loopback'。本机直连时对端就是 127.0.0.1，会被当成受信代理，
 * 于是攻击者手写的 X-Forwarded-For 反而被采信，等于白改。
 */
function resolveTrustProxy(raw?: string): boolean | number | string {
  const value = raw?.trim()
  if (!value) {
    return false
  }
  const lower = value.toLowerCase()
  if (['false', '0', 'off', 'no'].includes(lower)) {
    return false
  }
  if (['true', '1', 'on', 'yes'].includes(lower)) {
    // true 只信任最近一跳，比布尔 true（信任整条链、任何人可伪造）安全
    return 1
  }
  if (/^\d+$/.test(value)) {
    return Number(value)
  }
  return value
}

/** Swagger 是否开启：生产默认关闭，需要时用 SWAGGER_ENABLED=true 显式打开 */
function swaggerEnabled(): boolean {
  return envBoolean('SWAGGER_ENABLED', process.env.NODE_ENV !== 'production')
}

/** 文档页脚本的本地路径（Scalar 的 cdn 参数传它就自动切单文件 UMD，不再 import jsdelivr） */
const SCALAR_ASSET_FILE = 'scalar.standalone.js'

/**
 * 定位 `@scalar/api-reference` 的浏览器端 UMD 单文件（约 4.8MB）
 *
 * 为什么不用 CDN：`https://cdn.jsdelivr.net/npm/@scalar/api-reference/esm.js` 在国内网络下经常
 * `ERR_CONNECTION_CLOSED`，`/api/docs` 直接白屏。改成本地伺服后完全离线可用。
 *
 * 为什么先 resolve 主入口再拼路径：该包 `exports` 没开放 `./dist/*`，直接
 * `require.resolve('@scalar/api-reference/dist/browser/standalone.js')` 会抛 ERR_PACKAGE_PATH_NOT_EXPORTED。
 */
function resolveScalarBundleFile(): string | null {
  try {
    const entry = createRequire(__filename).resolve('@scalar/api-reference')
    const file = path.join(path.dirname(entry), 'browser', 'standalone.js')
    return statSync(file).isFile() ? file : null
  } catch {
    return null
  }
}

/**
 * 伺服文档页的前端脚本（本地自托管，断网/被墙都能开）
 *
 * 只有开了文档才注册；没装包时返回 null，调用方会退回默认 CDN。
 */
function registerDocsAssets(app: NestExpressApplication, globalPrefix: string, bundleFile: string): string {
  const assetUrl = `/${globalPrefix}/docs-assets/${SCALAR_ASSET_FILE}`
  const instance = app.getHttpAdapter().getInstance() as Express
  instance.get(assetUrl, (_req: Request, res: Response) => {
    // sendFile 自带 ETag / Last-Modified，二次访问直接 304，不会每次重下 4.8MB。
    // dotfiles 必须放开：pnpm 的真实路径在 node_modules/.pnpm/** 里，默认策略会把 `.pnpm` 当隐藏目录返回 404/500。
    res.sendFile(bundleFile, { maxAge: '1d', dotfiles: 'allow' }, err => {
      if (err && !res.headersSent) {
        console.error(`[docs] 文档脚本读取失败：${err.message}`)
        res.status(500).json({ code: 500, message: '文档脚本读取失败', result: null, success: false, timestamp: Date.now() })
      }
    })
  })
  return assetUrl
}

/**
 * API 端口的「门面」路由
 *
 * 3459 是纯 JSON API 服务，没有页面也没有图标。浏览器或 IM 里点开 http://host:3459
 * 只会得到裸 404，标签页还会反复请求 /favicon.ico（控制台刷 404，看着像服务挂了）。
 * 这里补两条不经过全局前缀的顶层路由：
 *  - `/`            → 开发/开了文档时 302 到 /api/docs；关文档时回一条最小 JSON 证明「我活着」
 *  - `/favicon.ico` → 204，浏览器拿到就不再重试（真图标属于前端 5173，不在这里）
 *
 * 注意注册位置：必须排在 helmet / compression 之后，否则这两条响应拿不到安全头。
 */
function registerApiLanding(app: NestExpressApplication, globalPrefix: string): void {
  const instance = app.getHttpAdapter().getInstance() as Express
  const docsPath = `/${globalPrefix}/docs`

  instance.get('/', (_req: Request, res: Response) => {
    if (swaggerEnabled()) {
      // 文档是本机开发时最想看的东西，直接送过去；关文档的生产环境不泄露这个路径
      res.redirect(302, docsPath)
      return
    }
    res.json({
      code: 0,
      message: 'concise-server-node API',
      result: null,
      success: true,
      timestamp: Date.now()
    })
  })

  instance.get('/favicon.ico', (_req: Request, res: Response) => {
    res.status(204).setHeader('Cache-Control', 'public, max-age=86400').end()
  })
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    instrument: ObserveInstrument,
    bufferLogs: true
  })

  // 用 winston 替换默认 Logger
  app.useLogger(app.get(LoggerService))

  const configService = app.get(ConfigService)
  const port = configService.get<number>('app.port', 3000)
  const globalPrefix = configService.get<string>('app.globalPrefix', 'api')

  app.setGlobalPrefix(globalPrefix)

  // 安全响应头：隐藏 X-Powered-By、加 X-Frame-Options / nosniff / Referrer-Policy 等
  // - CSP 交给静态目录自己管：这里是 JSON API，Swagger UI 又依赖内联脚本，全局开 CSP 只会打挂文档页
  // - 跨源策略放开，否则 5173 的前端拿不到 3000 的图片/静态资源
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false
    })
  )

  // 信任反向代理头（X-Forwarded-For 等）：默认只信本机，避免审计 IP 被伪造
  app.set('trust proxy', resolveTrustProxy(process.env.TRUST_PROXY))

  // 响应压缩：JSON 列表/树/导出场景体积砍 60~80%，带宽换 CPU（阈值 1KB，小响应不压）
  app.use(compression({ threshold: 1024 }))

  // 静态资源目录：public/upload 下的上传文件可直接以 {host}/upload/... 访问
  app.useStaticAssets(path.join(process.cwd(), 'public'), {
    setHeaders: (res, filePath) => {
      for (const [name, value] of Object.entries(STATIC_SAFE_HEADERS)) {
        res.setHeader(name, value)
      }
      // 非位图（历史遗留的 .html/.svg 等）强制下载，浏览器不会在原地渲染执行
      if (!INLINE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
        res.setHeader('Content-Disposition', 'attachment')
      }
    }
  })

  // 顶层门面路由（/ 与 /favicon.ico）：排在 helmet 之后才带得上安全头
  registerApiLanding(app, globalPrefix)

  // 全局 DTO 校验管道：自动转换类型 + 剔除未声明属性
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true
    })
  )

  // 接口文档三件套（生产默认关闭，暴露 117 个接口的入参结构与权限点等于给扫描器画地图）：
  //  - /api/docs      Scalar 现代化文档 UI（默认入口；前端脚本本地自托管，断网/被墙可用）
  //  - /api/docs-ui   原版 swagger-ui 备用入口（纯自托管，Scalar 出问题时的兜底）
  //  - /api/docs-json OpenAPI JSON（冒烟脚本与工具依赖，地址保持不变）
  if (swaggerEnabled()) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('concise-server-node API')
      .setDescription(
        [
          '中后台服务接口文档',
          '',
          '**统一响应结构**',
          '',
          '```json',
          '{ "code": 0, "message": "", "result": {}, "success": true, "timestamp": 1793768743245 }',
          '```',
          '',
          '- 成功：`code = 0`、`message = ""`、`success = true`，业务数据在 `result`',
          '- 业务异常：HTTP 200，`code` 为业务码、`success = false`、`result = null`',
          '- 参数/鉴权异常：`code` 等于 HTTP 状态码（400 / 401 / 403 / 429 …）',
          '- 各接口 `@ApiOkResponse` 的 `type` 只描述 `result` 内部的业务数据，不含外层包装',
          '- 文件下载（xlsx 导出）为二进制流，不参与包装',
          '',
          '**版本**：接口以 `/api/v1/**` 为准；旧版无前缀接口（`/api/auth/**`、`/api/users/**` 等）默认**不注册**（404），',
          '确有老客户端依赖时用 `LEGACY_ROUTES_ENABLED=true` 临时开启',
          '',
          '**列表结构**：所有列表查询接口统一返回 `{ records, total, current, size, pages }`；',
          '字典量级数据（`roles / depts / levels / posts / dicts / menus`）同样走这个结构，只是一次全量返回（`size = total`、`pages = 1`）；',
          '数据源类接口（`depts/tree`、`menus/tree`、`roles/options`、`dicts/code/:code`）不是列表查询，仍返回数组',
          '',
          '**常用业务码**：`412` 滑块位置错误、`413` 验证码过期（含已消费）、`417` 验证码参数缺失、`429` 请求过于频繁、',
          '`1001` 参数校验失败、`1003` 未授权、`1007` 登录失败、`1008` 账号停用、`1009` 密码错误次数过多账号锁定；',
          '`2101` 刷新令牌失效、`2104` 原密码错误、`3101` 内置角色保护、`3102` 角色编码冲突、`4102` 部门防环、`4103/4104` 部门删除保护、',
          '`5101` 字典编码冲突、`6101` 上传类型不支持、`6102` 文件签名校验失败、`6103` 导入表头不匹配、`6105` CSV 编码错误、`6106` 物理文件丢失、',
          '`8101` 租户编码冲突、`8102` 跨租户角色分配、`8103` 租户无 admin 角色模板。完整码表见 `src/common/enums/biz-error-code.enum.ts`（按业务域分段）'
        ].join('\n')
      )
      .setVersion('0.1')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
      .build()
    const document = SwaggerModule.createDocument(app, swaggerConfig)
    // swagger-ui 挂到 /docs-ui 备用，但 JSON 契约显式钉在 /docs-json（不改会跟着 setup 路径漂移）
    SwaggerModule.setup(`${globalPrefix}/docs-ui`, app, document, {
      jsonDocumentUrl: `${globalPrefix}/docs-json`,
      customSiteTitle: 'concise-server-node API'
    })
    // 主入口换 Scalar：左侧接口树 + 全局搜索 + 直接调试，theme 可在 Saturn/DeepSpace 等间切换
    // 脚本走本地自托管：传了 cdn 参数后渲染器会自动切「单文件 UMD + Scalar.createApiReference」，
    // 不再去 import jsdelivr 的 esm.js（那条 URL 在国内网络下会 ERR_CONNECTION_CLOSED 直接白屏）
    const scalarBundle = resolveScalarBundleFile()
    const scalarCdn = scalarBundle ? registerDocsAssets(app, globalPrefix, scalarBundle) : undefined
    if (!scalarBundle) {
      console.warn('[docs] 未找到 @scalar/api-reference 的本地 UMD 包，文档页将回退到 jsdelivr CDN（国内网络可能打不开）')
    }
    app.use(
      `/${globalPrefix}/docs`,
      apiReference({
        content: document,
        pageTitle: 'concise-server-node API',
        theme: 'saturn',
        layout: 'modern',
        ...(scalarCdn ? { cdn: scalarCdn } : {})
      })
    )
  }

  await app.listen(port)
  // 明确写清「这里没有页面」：本机最常踩的坑就是把 API 端口当管理后台打开，看到 404 以为服务挂了
  console.log(`API 就绪：http://localhost:${port}/${globalPrefix}（纯接口服务，不提供页面）`)
  console.log(`管理后台页面不在这个端口，请开前端 dev server（默认 http://localhost:5173）`)
  if (swaggerEnabled()) {
    console.log(`接口文档：http://localhost:${port}/${globalPrefix}/docs (Scalar) | swagger-ui: /${globalPrefix}/docs-ui`)
  }
}

bootstrap().catch((error: unknown) => {
  // 本地最常见的启动失败：上一次的 node dist/main.js 没退，端口还占着
  if ((error as NodeJS.ErrnoException)?.code === 'EADDRINUSE') {
    console.error(`\n端口已被占用（EADDRINUSE: ${String(process.env.PORT ?? '见 .env 的 PORT')}），大概率是上一次的 node dist/main.js 还在跑。`)
    console.error('  npm run start:prod    启动前自动结束旧实例（推荐）')
    console.error('  node scripts/serve.mjs --dry-run    只查看是谁占着，不做处理\n')
    process.exit(1)
  }
  console.error(error)
  process.exit(1)
})
