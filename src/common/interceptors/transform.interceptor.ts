import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor, StreamableFile } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

import { RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator'
import type { ApiResult } from '../interfaces/api-result.interface'

/**
 * 统一响应包装（code / message / result / success / timestamp）
 * 成功时固定返回：{ code: 0, message: '', result: <数据>, success: true, timestamp }
 * 文件流（StreamableFile / Buffer）为二进制下载，不参与包装
 * 标记 @RawResponse() 的端点（对外协议兼容，如 OAuth2 token）原样透传
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResult<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResult<T> | T> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [context.getHandler(), context.getClass()])
    return next.handle().pipe(
      map(data => {
        // 文件流等特殊响应不做包装；@RawResponse() 的对外协议端点保持原样
        if (raw || data instanceof StreamableFile || Buffer.isBuffer(data)) {
          return data
        }
        return {
          code: 0,
          message: '',
          result: data ?? null,
          success: true,
          timestamp: Date.now()
        } satisfies ApiResult<T>
      })
    )
  }
}
