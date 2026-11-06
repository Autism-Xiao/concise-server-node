import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import type { NestExpressApplication } from '@nestjs/platform-express'
import helmet from 'helmet'
import path from 'node:path'
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

  // 全局 DTO 校验管道：自动转换类型 + 剔除未声明属性
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true
    })
  )

  // Swagger 接口文档：/api/docs 在线查看，/api/docs-json 导出 OpenAPI 规范
  // 生产默认关闭（暴露 117 个接口的入参结构与权限点等于给扫描器画地图）
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
          '**版本**：接口以 `/api/v1/**` 为准；旧版无前缀接口（`/api/auth/**`、`/api/users/**` 等）仅为兼容保留，已从本文档排除',
          '',
          '**分页结构**：`users / notices / jobs / logs / online` 返回 `{ records, total, current, size, pages }`；',
          '`roles / depts / levels / posts / dicts / menus` 是字典量级的数据，返回纯数组（depts / menus 本质是树，不做分页）',
          '',
          '**常用业务码**：`412` 验证码错误、`413` 验证码过期、`415` 验证码已使用、`417` 验证码参数缺失、`429` 请求过于频繁、',
          '`1001` 参数校验失败、`1003` 未授权、`1007` 登录失败、`1008` 账号停用、`1009` 密码错误次数过多账号锁定'
        ].join('\n')
      )
      .setVersion('0.1')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
      .build()
    const document = SwaggerModule.createDocument(app, swaggerConfig)
    SwaggerModule.setup(`${globalPrefix}/docs`, app, document)
  }

  await app.listen(port)
  console.log(`Server running on http://localhost:${port}/${globalPrefix}`)
  if (swaggerEnabled()) {
    console.log(`Swagger docs: http://localhost:${port}/${globalPrefix}/docs`)
  }
}
void bootstrap()
