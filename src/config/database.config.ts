import { registerAs } from '@nestjs/config'
import type { DataSourceOptions } from 'typeorm'

import { env, envBoolean, envNumber } from '../global/env'

/**
 * 数据库配置
 * entities 采用 dist 路径供迁移 CLI 使用；运行时由 autoLoadEntities 自动收集
 */
export const databaseConfig = registerAs('database', (): DataSourceOptions => ({
  type: 'mysql',
  host: env('DB_HOST', '127.0.0.1'),
  port: envNumber('DB_PORT', 3306),
  username: env('DB_USERNAME', 'root'),
  password: env('DB_PASSWORD'),
  database: env('DB_DATABASE', 'concise_server'),
  entities: ['dist/modules/**/*.entity.js'],
  migrations: ['dist/migrations/*.js'],
  synchronize: envBoolean('DB_SYNCHRONIZE', false),
  logging: envBoolean('DB_LOGGING', false),
  charset: 'utf8mb4_unicode_ci',
  timezone: '+08:00',
  extra: {
    connectionLimit: 10
  }
}))
