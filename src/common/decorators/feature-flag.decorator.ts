import { SetMetadata } from '@nestjs/common'

export const FEATURE_FLAG_KEY = 'feature_flag'

export interface FeatureFlagOptions {
  /** 开关名（不含 `feature.` 前缀），对应 sys_config 的 `feature.<name>` */
  name: string
  /** 关闭时的提示文案；缺省用统一文案 */
  message?: string
}

/**
 * 租户级特性开关装饰器：开关关闭时对应端点整体 403。
 * 可打在 handler 或 controller 上（handler 优先）；全局 FeatureGuard 消费。
 *
 * @example @FeatureFlag('log.maskSensitive', '该租户未开通操作日志脱敏')
 */
export const FeatureFlag = (name: string, message?: string): MethodDecorator & ClassDecorator =>
  SetMetadata(FEATURE_FLAG_KEY, { name, message } satisfies FeatureFlagOptions)
