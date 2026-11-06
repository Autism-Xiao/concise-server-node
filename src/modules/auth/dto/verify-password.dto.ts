import { ApiProperty } from '@nestjs/swagger'
import { IsString, MaxLength, MinLength } from 'class-validator'

/** 校验当前登录用户的密码（锁屏解锁等场景）；失败与登录共用失败锁定计数 */
export class VerifyPasswordDto {
  @ApiProperty({ description: '当前登录用户的密码', example: 'admin123' })
  @IsString()
  @MinLength(6, { message: '密码长度须在 6~64 位之间' })
  @MaxLength(64, { message: '密码长度须在 6~64 位之间' })
  password!: string
}
