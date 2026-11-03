import {
  Injectable,
  type LoggerService as NestLoggerService,
  type LogLevel,
} from "@nestjs/common";

import { winstonLogger } from "./winston.logger";

/** 接入 NestJS 的 Logger 接口，通过 app.useLogger() 全局替换默认日志 */
@Injectable()
export class LoggerService implements NestLoggerService {
  log(message: unknown, context?: string): void {
    winstonLogger.info(String(message), { context });
  }

  error(message: unknown, trace?: string, context?: string): void {
    winstonLogger.error(trace ? `${String(message)}\n${trace}` : String(message), {
      context,
    });
  }

  warn(message: unknown, context?: string): void {
    winstonLogger.warn(String(message), { context });
  }

  debug(message: unknown, context?: string): void {
    winstonLogger.debug(String(message), { context });
  }

  verbose(message: unknown, context?: string): void {
    winstonLogger.verbose(String(message), { context });
  }

  setLogLevels?(_levels: LogLevel[]): void {
    // 交给 winston 自身的 level 控制，这里不做处理
  }
}
