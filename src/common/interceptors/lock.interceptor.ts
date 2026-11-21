import { Injectable, HttpStatus, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'

import { METHOD_LOCK_KEY, type LockOptions } from '../decorators/lock.decorator'
import { BizErrorCode } from '../enums/biz-error-code.enum'
import { BizException } from '../exceptions/biz.exception'
import { RedisService } from '../../shared/redis/redis.service'

/** 与 redis-lock.util 相同的原子释放：只有持锁者（token 匹配）能删 */
const UNLOCK_LUA = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end'

/**
 * 声明式互斥拦截器（全局注册，@Lock 标注才生效）
 *
 * 执行期互斥：抢到锁才进 handler，结束（成功/失败）即释放；抢不到直接拒绝（不是等待）。
 * 与 IdempotentInterceptor 的区别：幂等拦「同一请求重复发」，锁拦「同一操作并发执行」
 * ——比如同租户两个管理员同时改同一份套餐配置，键相同即互斥。
 *
 * 降级：Redis 不可用放行（单实例语义）；释放失败只等 TTL 自然过期，不影响业务结果。
 */
@Injectable()
export class LockInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<LockOptions | undefined>(METHOD_LOCK_KEY, [context.getHandler(), context.getClass()])
    if (!options) return next.handle()

    const client = this.redis.client
    if (!client) return next.handle()

    const handler = context.getHandler()
    const className = context.getClass().name
    const key = options.key ?? `lock:${className}.${handler.name}`
    const ttl = Math.min(Math.max(Math.trunc(options.ttl ?? 30), 1), 300)
    const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`

    // 同步阶段先抢锁：抢到才进入 handler 流；失败立刻拒绝（release 挂在 finally 语义的 tap finalize 上）
    const acquire = client.set(key, token, 'EX', ttl, 'NX')
    return new Observable<unknown>(subscriber => {
      void acquire
        .then(acquired => {
          if (acquired !== 'OK') {
            subscriber.error(new BizException(BizErrorCode.RATE_LIMITED, options.message ?? '操作正在处理中，请稍后再试', HttpStatus.TOO_MANY_REQUESTS))
            return
          }
          next
            .handle()
            .pipe(
              tap({
                complete: () => void this.release(key, token),
                error: () => void this.release(key, token)
              })
            )
            .subscribe(subscriber)
        })
        .catch(error => subscriber.error(error))
    })
  }

  private async release(key: string, token: string): Promise<void> {
    try {
      await this.redis.client?.eval(UNLOCK_LUA, 1, key, token)
    } catch {
      // 释放失败 = 锁等 TTL 过期，不影响业务结果
    }
  }
}
