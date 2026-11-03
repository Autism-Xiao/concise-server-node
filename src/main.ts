import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule, ObserveInstrument } from './app.module'
import { LoggerService } from './shared/logger/logger.service'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
    bufferLogs: true
  })

  // 用 winston 替换默认 Logger
  app.useLogger(app.get(LoggerService))

  const configService = app.get(ConfigService)
  const port = configService.get<number>('app.port', 3000)
  const globalPrefix = configService.get<string>('app.globalPrefix', 'api')

  app.setGlobalPrefix(globalPrefix)

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
    .setDescription('中后台服务接口文档')
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
