import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";

import { winstonLogger } from "../../shared/logger/winston.logger";
import { BusinessException } from "../exceptions/business.exception";

interface ExceptionResponse {
  message: string | string[];
  code?: number;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ method: string; url: string }>();

    if (exception instanceof BusinessException) {
      // 业务异常：HTTP 200，用 code 区分
      return response.status(HttpStatus.OK).json({
        code: exception.getBizCode(),
        data: null,
        message: exception.message,
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const raw =
        typeof res === "string" ? res : (res as ExceptionResponse).message;
      // class-validator 的错误是数组，只取第一条
      const message = Array.isArray(raw) ? raw[0] : raw;
      return response.status(status).json({
        code: status,
        data: null,
        message: message ?? exception.message,
      });
    }

    // 未知异常：记录完整堆栈，对外只暴露通用提示
    winstonLogger.error(
      `${request.method} ${request.url} -> ${exception instanceof Error ? exception.stack : String(exception)}`,
    );
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: HttpStatus.INTERNAL_SERVER_ERROR,
      data: null,
      message: "Internal server error",
    });
  }
}
