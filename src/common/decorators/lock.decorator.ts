import { SetMetadata } from '@nestjs/common'

/** 元数据键：@Lock 标注的端点由 LockInterceptor 做执行期互斥 */
export const METHOD_LOCK_KEY = 'method-lock:options'

export interface LockOptions {
  /** 锁键（默认 `lock:{ClassName}.{methodName}`）；同一 key 全局互斥 */
  key?: string
  /** 锁 TTL（秒），默认 30：必须大于方法最长执行时间，过期后可能并发穿透 */
  ttl?: number
  /** 抢锁失败时的提示文案 */
  message?: string
}

/**
 * 声明式互斥锁：同一 key 的并发请求只执行一个，其余直接拒绝（不是排队等待）。
 *
 * 适用：多实例部署下「同租户同时开通/同时改配置」这类读改写竞态；
 * Redis 不可用时退化为放行（与项目限流/锁的既有降级策略一致）。
 */
export const Lock = (options?: LockOptions): MethodDecorator => SetMetadata(METHOD_LOCK_KEY, options ?? {})
