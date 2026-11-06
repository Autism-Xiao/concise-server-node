import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'

/** 重置密码：新密码留空则由服务端生成 12 位易读随机口令（明文仅在本次响应返回一次） */
export class ResetUserPasswordDto {
  @ApiPropertyOptional({ description: '新密码（8~32 位，字母+数字）；留空则自动生成随机口令', example: '' })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: '新密码至少 8 位' })
  @MaxLength(32, { message: '新密码最长 32 位' })
  @Matches(/[A-Za-z]/, { message: '新密码必须包含字母' })
  @Matches(/\d/, { message: '新密码必须包含数字' })
  password?: string
}
