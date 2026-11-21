import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable, tap } from 'rxjs'

import { MeteringService } from './metering.service'

/**
 * 计量所有 HTTP 请求（成功记 api.calls，异常记 api.errors）。
 * 注册在 TransformInterceptor 内层，只观察不修改响应数据； tenantId<=0 的请求在 service 内跳过。
 */
@Injectable()
export class MeteringInterceptor implements NestInterceptor {
  constructor(private readonly metering: MeteringService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      tap({
        next: () => this.metering.record('api.calls'),
        error: () => this.metering.record('api.errors')
      })
    )
  }
}
