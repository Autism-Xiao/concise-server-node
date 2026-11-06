import { ApiProperty } from '@nestjs/swagger'
import { IsString, Matches, MaxLength, MinLength } from 'class-validator'

/** 自助修改密码：验旧密码成功后写入新密码，其他端全部下线（保留当前会话） */
export class ChangePasswordDto {
  @ApiProperty({ description: '原密码', example: 'old-password' })
  @IsString()
  oldPassword!: string

  @ApiProperty({ description: '新密码（8~32 位，字母+数字）', example: 'NewPass2026' })
  @IsString()
  @MinLength(8, { message: '新密码至少 8 位' })
  @MaxLength(32, { message: '新密码最长 32 位' })
  @Matches(/[A-Za-z]/, { message: '新密码必须包含字母' })
  @Matches(/\d/, { message: '新密码必须包含数字' })
  newPassword!: string
}
