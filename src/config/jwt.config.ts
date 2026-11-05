import { registerAs, type ConfigType } from '@nestjs/config'
import type { StringValue } from 'ms'

import { env } from '../global/env'

/**
 * JWT 配置命名空间（jwt.*）
 *
 * 职责：
 * - 集中 accessToken / refreshToken 的密钥与有效期，告警点只有这一处；
 * - `expiresIn` 在此一次性断言为 ms 包的 `StringValue`（@nestjs/jwt 要求的类型），
 *   调用点不再各写一遍 `as StringValue`；
 * - 密钥缺失由 config/env.validation.ts 在启动期拦截，不依赖这里的默认值。
 */
export const jwtConfig = registerAs('jwt', () => ({
  /** accessToken 签名密钥（生产必须由环境变量提供，长度 ≥ 16） */
  secret: env('JWT_SECRET'),
  /** accessToken 有效期，如 2h */
  expiresIn: env('JWT_EXPIRES_IN', '2h') as StringValue,
  /** refreshToken 签名密钥（与 access 分开，避免一套密钥被复用） */
  refreshSecret: env('JWT_REFRESH_SECRET'),
  /** refreshToken 有效期，如 7d */
  refreshExpiresIn: env('JWT_REFRESH_EXPIRES_IN', '7d') as StringValue
}))

export type JwtConfig = ConfigType<typeof jwtConfig>
