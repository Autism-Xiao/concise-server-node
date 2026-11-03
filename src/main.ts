import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { AppModule, ObserveInstrument } from "./app.module";
import { LoggerService } from "./shared/logger/logger.service";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
    bufferLogs: true,
  });

  // 用 winston 替换默认 Logger
  app.useLogger(app.get(LoggerService));

  const configService = app.get(ConfigService);
  const port = configService.get<number>("app.port", 3000);
  const globalPrefix = configService.get<string>("app.globalPrefix", "api");

  app.setGlobalPrefix(globalPrefix);

  await app.listen(port);
  console.log(`Server running on http://localhost:${port}/${globalPrefix}`);
}
void bootstrap();
