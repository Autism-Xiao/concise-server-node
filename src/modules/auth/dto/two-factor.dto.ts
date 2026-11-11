import { ApiProperty } from '@nestjs/swagger'
import { IsString, Matches } from 'class-validator'

/** 两步验证 6 位动态码（激活 / 关闭共用） */
export class TwoFactorCodeDto {
  @ApiProperty({ description: '认证器 App 当前的 6 位动态码', example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: '验证码须为 6 位数字' })
  code!: string
}
