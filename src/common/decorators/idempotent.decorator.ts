import { SetMetadata } from '@nestjs/common'

/** 元数据键：@Idempotent 标注的端点由 IdempotentInterceptor 做同参防重 */
export const IDEMPOTENT_KEY = 'idempotent:options'

export interface IdempotentOptions {
  /** 防重窗口（秒），默认 10；窗口内同用户+同路由+同 body 的重复请求直接拒绝 */
  window?: number
  /** 命中重复时的提示文案 */
  message?: string
}

/**
 * 声明式幂等防重：标注后，窗口内「同用户 + 同路由 + 同请求体」只放行一次。
 *
 * 适用：扣配额、开通/分配类「连点两下会造成双份副作用」的写接口。
 * 不适用：查询接口（天然幂等）、由前端防抖已兜住的普通表单。
 */
export const Idempotent = (options?: IdempotentOptions): MethodDecorator => SetMetadata(IDEMPOTENT_KEY, options ?? {})
