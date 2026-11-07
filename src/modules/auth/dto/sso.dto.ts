import { ApiProperty } from '@nestjs/swagger'
import { IsString, Length } from 'class-validator'

export class ExchangeSsoCodeDto {
  @ApiProperty({ description: 'SSO 回调签发的一次性登录 code（2 分钟有效，用后即焚）', example: 'a1b2c3...' })
  @IsString({ message: 'code 必须是字符串' })
  @Length(32, 128, { message: 'code 长度不合法' })
  code!: string
}
