import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, Length, Matches } from 'class-validator'

export class ExchangeSsoCodeDto {
  @ApiProperty({ description: 'SSO 回调签发的一次性登录 code（2 分钟有效，用后即焚）', example: 'a1b2c3...' })
  @IsString({ message: 'code 必须是字符串' })
  @Length(32, 128, { message: 'code 长度不合法' })
  code!: string

  @ApiPropertyOptional({ description: '6 位动态码或 8 位备份码：账号开启两步验证时必填（首次不带会返回 2105）', example: '123456' })
  @IsOptional()
  @IsString()
  @Matches(/^(\d{6}|[A-Za-z0-9]{4}-?[A-Za-z0-9]{4})$/, { message: '验证码须为 6 位动态码，或 8 位备份码' })
  totpCode?: string
}
