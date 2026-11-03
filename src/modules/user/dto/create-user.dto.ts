import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator'

export class CreateUserDto {
  @ApiProperty({ description: '用户名（3~32 位，唯一）', example: 'zhangsan', minLength: 3, maxLength: 32 })
  @IsString()
  @Length(3, 32, { message: '用户名长度须在 3~32 位之间' })
  username: string

  @ApiProperty({ description: '昵称', example: '张三', maxLength: 32 })
  @IsString()
  @Length(1, 32)
  nickname: string

  @ApiProperty({ description: '密码（6~64 位，入库前自动 bcrypt 哈希）', example: '123456', minLength: 6, maxLength: 64 })
  @IsString()
  @Length(6, 64, { message: '密码长度须在 6~64 位之间' })
  password: string

  @ApiPropertyOptional({ description: '邮箱', example: 'zhangsan@test.com' })
  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string

  @ApiPropertyOptional({ description: '状态：0 禁用 / 1 启用', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsIn([0, 1])
  status?: number
}
