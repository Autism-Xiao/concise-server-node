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
        '**统一响应结构（对齐 JeecgBoot Result）**',
        '',
        '```json',
        '{ "code": 0, "message": "", "result": {}, "success": true, "timestamp": 1793768743245 }',
        '```',
        '',
        '- 成功：`code = 0`、`message = ""`、`success = true`，业务数据在 `result`',
        '- 业务异常：HTTP 200，`code` 为业务码、`success = false`、`result = null`',
        '- 参数/鉴权异常：`code` 等于 HTTP 状态码（400 / 401 / 403 …）',
        '- 各接口 `@ApiOkResponse` 的 `type` 只描述 `result` 内部的业务数据，不含外层包装',
        '- 文件下载（CSV 导出）为二进制流，不参与包装'
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
