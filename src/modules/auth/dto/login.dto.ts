import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString, Length } from 'class-validator'

export class LoginDto {
  @ApiProperty({ description: '用户名', example: 'admin' })
  @IsString()
  @IsNotEmpty({ message: '用户名不能为空' })
  username: string

  @ApiProperty({ description: '密码', example: 'admin123' })
  @IsString()
  @Length(6, 64, { message: '密码长度须在 6~64 位之间' })
  password: string

  @ApiPropertyOptional({ description: '验证码 ID（CAPTCHA_ENABLED=true 时必填，来自 GET /auth/captcha）' })
  @IsOptional()
  @IsString()
  captchaId?: string

  @ApiPropertyOptional({ description: '用户输入的验证码（不区分大小写）', example: 'ab3d' })
  @IsOptional()
  @IsString()
  @Length(4, 4, { message: '验证码为 4 位字符' })
  captchaCode?: string
}

export class RefreshTokenDto {
  @ApiProperty({ description: '登录时返回的 refreshToken' })
  @IsString()
  @IsNotEmpty({ message: 'refreshToken 不能为空' })
  refreshToken: string
}

/** 登录成功响应 */
export class LoginResultDto {
  @ApiProperty({ description: '访问令牌，请求时放入 Authorization: Bearer <token>' })
  accessToken: string

  @ApiProperty({ description: '刷新令牌，用于换取新的令牌对' })
  refreshToken: string

  @ApiProperty({ description: 'accessToken 有效期（秒）', example: 7200 })
  expiresIn: number

  @ApiProperty({ description: '用户信息（不含密码）' })
  userInfo: Record<string, unknown>
}
