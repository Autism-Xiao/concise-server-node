import { appConfig } from './app.config'
import { databaseConfig } from './database.config'

/** 所有配置统一在此导出，供 ConfigModule.forRoot({ load }) 使用 */
export const configs = [appConfig, databaseConfig]
