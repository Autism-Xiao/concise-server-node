import { appConfig } from './app.config'
import { captchaConfig } from './captcha.config'
import { databaseConfig } from './database.config'
import { jwtConfig } from './jwt.config'
import { redisConfig } from './redis.config'

/**
 * 所有配置统一在此导出，供 ConfigModule.forRoot({ load }) 使用
 * 每个 registerAs 命名空间同时也是一个可注入 token（`@Inject(redisConfig.KEY)`）
 */
export const configs = [appConfig, databaseConfig, redisConfig, jwtConfig, captchaConfig]

export { appConfig, captchaConfig, databaseConfig, jwtConfig, redisConfig }
export type { CaptchaConfig } from './captcha.config'
export type { JwtConfig } from './jwt.config'
export type { RedisConfig } from './redis.config'
