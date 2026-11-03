import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString, Length } from 'class-validator'

export class LoginDto {
  @ApiProperty({ description: '用户名', example: 'admin' })
  @IsString()
  @IsNotEmpty({ message: '用户名不能为空' })
  username: string

  @ApiProperty({ description: '密码', example: 'admin123' })
  @IsString()
  @Length(6, 64, { message: '密码长度须在 6~64 位之间' })
  password: string
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
