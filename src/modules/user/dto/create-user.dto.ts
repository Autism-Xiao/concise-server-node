import { IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator'

export class CreateUserDto {
  @IsString()
  @Length(3, 32, { message: '用户名长度须在 3~32 位之间' })
  username: string

  @IsString()
  @Length(1, 32)
  nickname: string

  @IsString()
  @Length(6, 64, { message: '密码长度须在 6~64 位之间' })
  password: string

  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string

  @IsOptional()
  @IsIn([0, 1])
  status?: number
}
