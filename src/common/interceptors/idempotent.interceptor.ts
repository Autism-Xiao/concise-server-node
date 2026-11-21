import { Injectable, HttpStatus, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { createHash } from 'node:crypto'
import { from, type Observable } from 'rxjs'
import { mergeMap } from 'rxjs/operators'

import { IDEMPOTENT_KEY, type IdempotentOptions } from '../decorators/idempotent.decorator'
import { BizErrorCode } from '../enums/biz-error-code.enum'
import { BizException } from '../exceptions/biz.exception'
import { TenantContext } from '../../shared/tenant/tenant.context'
import { RedisService } from '../../shared/redis/redis.service'

interface RequestLike {
  method?: string
  route?: { path?: string }
  originalUrl?: string
  url?: string
  ip?: string
  body?: unknown
  user?: { id?: string }
}

/**
 * 声明式幂等拦截器（全局注册，@Idempotent 标注才生效）
 *
 * 键 = 路由模板 + 用户 + 请求体哈希：同一个人双击同一个请求才拦，
 * 不同人/不同参数互不影响。窗口 SET NX EX 过期自动解除，无需手动清理。
 *
 * 降级：Redis 不可用直接放行——幂等拦截是防「双份副作用」的最后闸门，
 * 多实例内存计数会误拦跨实例的正常请求，宁可不拦。
 */
@Injectable()
export class IdempotentInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<IdempotentOptions | undefined>(IDEMPOTENT_KEY, [context.getHandler(), context.getClass()])
    if (!options) return next.handle()

    const request = context.switchToHttp().getRequest<RequestLike>()
    if (!request || request.method === 'GET') return next.handle()

    const client = this.redis.client
    if (!client) return next.handle()

    const route = request.route?.path ?? request.originalUrl ?? request.url ?? 'unknown'
    const bodyHash = createHash('sha256')
      .update(JSON.stringify(request.body ?? {}))
      .digest('hex')
      .slice(0, 32)
    const userId = request.user?.id ?? request.ip ?? 'anonymous'
    const key = `idem:${route}:${TenantContext.filterTenantId() ?? 0}:${userId}:${bodyHash}`
    const window = Math.min(Math.max(Math.trunc(options.window ?? 10), 1), 300)

    return from(this.redis.client.set(key, '1', 'EX', window, 'NX')).pipe(
      mergeMap(acquired => {
        if (acquired !== 'OK') {
          throw new BizException(BizErrorCode.RATE_LIMITED, options.message ?? '请勿重复提交', HttpStatus.TOO_MANY_REQUESTS)
        }
        return next.handle()
      })
    )
  }
}
