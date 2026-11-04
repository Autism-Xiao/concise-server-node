import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor, StreamableFile } from '@nestjs/common'
import type { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

import type { ApiResult } from '../interfaces/api-result.interface'

/**
 * 统一响应包装（对齐 JeecgBoot Result<T>）
 * 成功时固定返回：{ code: 0, message: '', result: <数据>, success: true, timestamp }
 * 文件流（StreamableFile / Buffer）为二进制下载，不参与包装
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResult<T> | T> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiResult<T> | T> {
    return next.handle().pipe(
      map(data => {
        // 文件流等特殊响应不做包装
        if (data instanceof StreamableFile || Buffer.isBuffer(data)) {
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
