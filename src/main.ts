import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import type { NestExpressApplication } from '@nestjs/platform-express'
import path from 'node:path'
import { AppModule, ObserveInstrument } from './app.module'
import { LoggerService } from './shared/logger/logger.service'

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

  // 信任反向代理头（X-Forwarded-For 等）：挂在 Nginx 后面时 req.ip 才是客户端真实 IP，登录日志/操作日志依赖它
  app.set('trust proxy', true)

  // 静态资源目录：public/upload 下的上传文件可直接以 {host}/upload/... 访问
  app.useStaticAssets(path.join(process.cwd(), 'public'))

  // 全局 DTO 校验管道：自动转换类型 + 剔除未声明属性
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true
    })
  )

  // Swagger 接口文档：/api/docs 在线查看，/api/docs-json 导出 OpenAPI 规范
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
        '- 参数/鉴权异常：`code` 等于 HTTP 状态码（400 / 401 / 403 …）',
        '- 各接口 `@ApiOkResponse` 的 `type` 只描述 `result` 内部的业务数据，不含外层包装',
        '- 文件下载（CSV 导出）为二进制流，不参与包装',
        '',
        '**版本**：认证接口已提供 `/api/v1/auth/**`，旧 `/api/auth/**` 继续保留兼容',
        '',
        '**常用业务码**：`412` 验证码错误、`413` 验证码过期、`415` 验证码已使用、`417` 验证码参数缺失、`1001` 参数校验失败、`1003` 未授权、`1007` 登录失败、`1008` 账号停用'
      ].join('\n')
    )
    .setVersion('0.1')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
    .build()
  const document = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup(`${globalPrefix}/docs`, app, document)

  await app.listen(port)
  console.log(`Server running on http://localhost:${port}/${globalPrefix}`)
  console.log(`Swagger docs: http://localhost:${port}/${globalPrefix}/docs`)
}
void bootstrap()
