import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, Matches } from 'class-validator'

/**
 * 授予 / 取消 VIP
 *
 * 与平台管理员同理单独一个端点：VIP 是「能否自助开通租户」的开关，
 * 权限点 system:user:vip 的 scope=platform，只有平台管理员能调。
 * 取消 VIP 不清空已开的租户（VIP 只是开通资格）。
 */
export class UpdateUserVipDto {
  @ApiProperty({ description: '1 授予 VIP；0 取消', example: 1, enum: [0, 1] })
  @IsIn([0, 1], { message: 'vipLevel 只能是 0 或 1' })
  vipLevel: number

  @ApiPropertyOptional({ description: 'VIP 到期日 YYYY-MM-DD；不传/空 = 永久有效（仅 vipLevel=1 时有意义）', example: '2027-11-17' })
  @IsOptional()
  @IsString()
  @Matches(/^(\d{4}-\d{2}-\d{2})?$/, { message: '到期日格式应为 YYYY-MM-DD 或留空' })
  vipExpireAt?: string
}
