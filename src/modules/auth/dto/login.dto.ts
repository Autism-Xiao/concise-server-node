import { IsNotEmpty, IsString, Length } from 'class-validator'

export class LoginDto {
  @IsString()
  @IsNotEmpty({ message: '用户名不能为空' })
  username: string

  @IsString()
  @Length(6, 64, { message: '密码长度须在 6~64 位之间' })
  password: string
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty({ message: 'refreshToken 不能为空' })
  refreshToken: string
}
