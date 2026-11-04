import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'
import type { Response } from 'express'

import { winstonLogger } from '../../shared/logger/winston.logger'
import { BizErrorCode } from '../enums/biz-error-code.enum'
import { BizException } from '../exceptions/biz.exception'
import type { ApiResult } from '../interfaces/api-result.interface'

interface ExceptionResponse {
  message: string | string[]
  code?: number
}

/** 常见 HTTP 状态码 → 业务错误码 */
const HTTP_STATUS_TO_BIZ_CODE: Record<number, BizErrorCode> = {
  [HttpStatus.BAD_REQUEST]: BizErrorCode.PARAM_INVALID,
  [HttpStatus.UNAUTHORIZED]: BizErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: BizErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: BizErrorCode.NOT_FOUND
}

/** Nest 内置异常默认的英文提示，出现时替换成中文 */
const DEFAULT_EN_MESSAGES: Record<number, string> = {
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found'
}

/** 默认中文提示 */
const DEFAULT_CN_MESSAGES: Record<number, string> = {
  [HttpStatus.UNAUTHORIZED]: '未授权，请先登录',
  [HttpStatus.FORBIDDEN]: '禁止访问',
  [HttpStatus.NOT_FOUND]: '资源不存在'
}

/** 组装失败响应（result 恒为 null，success 恒为 false） */
function fail(code: number, message: string): ApiResult<null> {
  return { code, message, result: null, success: false, timestamp: Date.now() }
}

/** 从 HttpException 里取展示文案：class-validator 返回数组，只取第一条 */
function pickMessage(exception: HttpException): string {
  const res = exception.getResponse()
  const raw = typeof res === 'string' ? res : (res as ExceptionResponse).message
  if (Array.isArray(raw)) {
    return raw[0] ?? exception.message
  }
  return raw ?? exception.message
}

/** 英文默认提示换中文；有自定义 message 时原样保留 */
function localize(status: number, message: string): string {
  if (!message || message === DEFAULT_EN_MESSAGES[status]) {
    return DEFAULT_CN_MESSAGES[status] ?? message
  }
  return message
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<{ method: string; url: string }>()

    // 1. 业务异常：code 用枚举值，HTTP 状态由异常自身决定（默认 200）
    if (exception instanceof BizException) {
      return response.status(exception.getStatus()).json(fail(exception.getBizCode(), exception.message))
    }

    // 2. Nest 内置异常：HTTP 状态保留，code 映射成业务码
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const code = HTTP_STATUS_TO_BIZ_CODE[status] ?? BizErrorCode.INTERNAL_ERROR
      return response.status(status).json(fail(code, localize(status, pickMessage(exception))))
    }

    // 3. 未知异常：记录完整堆栈，对外只暴露通用提示
    winstonLogger.error(`${request.method} ${request.url} -> ${exception instanceof Error ? exception.stack : String(exception)}`)
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(fail(BizErrorCode.INTERNAL_ERROR, '服务器内部错误'))
  }
}
