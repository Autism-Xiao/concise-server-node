import { registerAs } from '@nestjs/config'
import type { DataSourceOptions } from 'typeorm'

import { env, envBoolean, envNumber } from '../global/env'
import { SnakeNamingStrategy } from '../shared/database/snake-naming.strategy'

/**
 * 数据库配置
 * entities 采用 dist 路径供迁移 CLI 使用；运行时由 autoLoadEntities 自动收集
 * namingStrategy：全局 snake_case —— 实体驼峰属性自动映射下划线列名
 * （createdAt→created_at、deptId→dept_id），与 JeecgBoot 表结构风格一致
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
  namingStrategy: new SnakeNamingStrategy(),
  synchronize: envBoolean('DB_SYNCHRONIZE', false),
  logging: envBoolean('DB_LOGGING', false),
  charset: 'utf8mb4_unicode_ci',
  timezone: '+08:00',
  extra: {
    connectionLimit: 10
  }
}))
