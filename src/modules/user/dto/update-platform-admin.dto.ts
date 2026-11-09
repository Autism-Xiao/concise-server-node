import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean } from 'class-validator'

/**
 * 授予/取消平台管理员
 *
 * 刻意不并进 UpdateUserDto：isPlatformAdmin 是「平台层 / 租户层」的唯一分界，
 * 任何能改用户资料的租户管理员都不该有能力动它。
 */
export class UpdatePlatformAdminDto {
  @ApiProperty({ description: 'true 授予平台管理员；false 取消', example: true })
  @IsBoolean({ message: 'isPlatformAdmin 必须是布尔值' })
  isPlatformAdmin: boolean
}
