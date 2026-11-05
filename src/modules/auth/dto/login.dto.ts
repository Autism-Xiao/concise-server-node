import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsNotEmpty, IsNumber, IsOptional, IsString, Length } from 'class-validator'

export class LoginDto {
  @ApiProperty({ description: '用户名', example: 'admin' })
  @IsString()
  @IsNotEmpty({ message: '用户名不能为空' })
  username: string

  @ApiProperty({ description: '密码', example: 'admin123' })
  @IsString()
  @Length(6, 64, { message: '密码长度须在 6~64 位之间' })
  password: string

  @ApiPropertyOptional({
    description: '滑块验证通过后由 POST /auth/captcha/verify 返回的一次性票据（CAPTCHA_ENABLED=true 时必填，2 分钟内有效、只能用一次）',
    example: '3f1c9e2a-5b7d-4c8e-9a1f-2d3e4f5a6b7c'
  })
  @IsOptional()
  @IsString()
  captchaTicket?: string
}

/** 滑块验证码校验入参 */
export class VerifyCaptchaDto {
  @ApiProperty({ description: '验证码 ID，来自 GET /auth/captcha' })
  @IsString()
  @IsNotEmpty({ message: 'captchaId 不能为空' })
  captchaId: string

  @ApiProperty({ description: '拼图横向拖动距离（像素），由前端滑块组件回传', example: 137 })
  @IsNumber({}, { message: 'x 必须是数字' })
  x: number
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
