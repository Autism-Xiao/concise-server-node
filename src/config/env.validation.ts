import { plainToInstance } from 'class-transformer'
import { IsIn, IsNumberString, IsOptional, IsString, Matches, MinLength, validateSync } from 'class-validator'

/** 布尔型环境变量允许的写法（与 global/env.ts 的 envBoolean 保持一致） */
const BOOLEAN_STRINGS = ['true', 'false', '1', '0', 'on', 'off', 'yes', 'no']

/**
 * 环境变量 schema（启动期校验）
 *
 * 目标：配置错误在**进程启动时**暴露，而不是等第一个请求打到 JWT 签名/数据库连接才 500。
 * 只校验「缺失/格式」，不负责转换类型 —— 类型转换在各 *.config.ts 里用 global/env.ts 完成。
 *
 * 加字段的规矩：新增环境变量时同步在此声明，可选配置用 @IsOptional，必填配置不加。
 */
class EnvironmentVariables {
  @IsOptional()
  @IsNumberString({}, { message: 'PORT 必须是数字' })
  PORT?: string

  @IsOptional()
  @IsString()
  API_PREFIX?: string

  @IsOptional()
  @IsString()
  DB_HOST?: string

  @IsOptional()
  @IsNumberString({}, { message: 'DB_PORT 必须是数字' })
  DB_PORT?: string

  @IsOptional()
  @IsString()
  DB_USERNAME?: string

  @IsOptional()
  @IsString()
  DB_PASSWORD?: string

  @IsOptional()
  @IsString()
  DB_DATABASE?: string

  @IsOptional()
  @IsIn(BOOLEAN_STRINGS, { message: 'DB_SYNCHRONIZE 只能是 true/false/1/0/on/off/yes/no' })
  DB_SYNCHRONIZE?: string

  @IsOptional()
  @IsIn(BOOLEAN_STRINGS, { message: 'DB_LOGGING 只能是 true/false/1/0/on/off/yes/no' })
  DB_LOGGING?: string

  /** accessToken 密钥：必填，太短等于没加密 */
  @IsString({ message: '缺少 JWT_SECRET（accessToken 签名密钥）' })
  @MinLength(16, { message: 'JWT_SECRET 长度至少 16 位' })
  JWT_SECRET!: string

  @IsOptional()
  @Matches(/^\d+[smhd]$/, { message: 'JWT_EXPIRES_IN 格式应为 2h / 30m / 7d 这类' })
  JWT_EXPIRES_IN?: string

  /** refreshToken 密钥：必填，且应与 JWT_SECRET 不同（启动期只校验存在与长度） */
  @IsString({ message: '缺少 JWT_REFRESH_SECRET（refreshToken 签名密钥）' })
  @MinLength(16, { message: 'JWT_REFRESH_SECRET 长度至少 16 位' })
  JWT_REFRESH_SECRET!: string

  @IsOptional()
  @Matches(/^\d+[smhd]$/, { message: 'JWT_REFRESH_EXPIRES_IN 格式应为 2h / 30m / 7d 这类' })
  JWT_REFRESH_EXPIRES_IN?: string

  @IsOptional()
  @IsIn(BOOLEAN_STRINGS, { message: 'CAPTCHA_ENABLED 只能是 true/false/1/0/on/off/yes/no' })
  CAPTCHA_ENABLED?: string

  @IsOptional()
  @IsIn(BOOLEAN_STRINGS, { message: 'REDIS_ENABLED 只能是 true/false/1/0/on/off/yes/no' })
  REDIS_ENABLED?: string

  @IsOptional()
  @IsString()
  REDIS_HOST?: string

  @IsOptional()
  @IsNumberString({}, { message: 'REDIS_PORT 必须是数字' })
  REDIS_PORT?: string

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string

  @IsOptional()
  @IsNumberString({}, { message: 'REDIS_DB 必须是数字' })
  REDIS_DB?: string
}

/**
 * 传给 ConfigModule.forRoot({ validate }) 的校验函数
 * 校验失败直接抛错 → bootstrap 中断，不会带着错误配置跑起来
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const instance = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: false })
  const errors = validateSync(instance, { skipMissingProperties: false })

  if (errors.length > 0) {
    const details = errors
      .map(error => Object.values(error.constraints ?? {}).join('；'))
      .filter(Boolean)
      .map(text => `  - ${text}`)
      .join('\n')
    throw new Error(`环境变量校验未通过，请检查 .env：\n${details}`)
  }

  return config
}
