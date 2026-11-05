import { registerAs, type ConfigType } from '@nestjs/config'

import { envBoolean } from '../global/env'

/**
 * 图形验证码配置命名空间（captcha.*）
 *
 * - enabled：登录是否强制校验验证码（对齐原 CAPTCHA_ENABLED，默认 false 保持既有行为）
 * - debug：验证码接口是否附带明文 code，仅限开发环境，生产必须关闭
 */
export const captchaConfig = registerAs('captcha', () => ({
  enabled: envBoolean('CAPTCHA_ENABLED', false),
  debug: envBoolean('CAPTCHA_DEBUG', false)
}))

export type CaptchaConfig = ConfigType<typeof captchaConfig>
