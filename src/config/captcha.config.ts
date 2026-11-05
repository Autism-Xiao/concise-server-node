import { registerAs, type ConfigType } from '@nestjs/config'

import { envBoolean } from '../global/env'

/**
 * 验证码配置命名空间（captcha.*）
 *
 * - enabled：登录是否强制校验滑块验证码（对齐原 CAPTCHA_ENABLED，默认 false 保持既有行为）
 *
 * 说明：滑块验证码没有「明文 code」，原 debug 开关已随 svg-captcha 一起下线；
 * .env 里若还留着 CAPTCHA_DEBUG，会被忽略（不影响启动）。
 */
export const captchaConfig = registerAs('captcha', () => ({
  enabled: envBoolean('CAPTCHA_ENABLED', false)
}))

export type CaptchaConfig = ConfigType<typeof captchaConfig>
