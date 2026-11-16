import { ApiProperty } from '@nestjs/swagger'
import { IsString, Length, Matches, MaxLength, MinLength } from 'class-validator'

/** 申请重置密码：给账号（或绑定邮箱）发一次性验证码 */
export class ForgotPasswordDto {
  @ApiProperty({ description: '登录账号或账号绑定的邮箱', example: 'zhangsan' })
  @IsString()
  @Length(1, 100, { message: '账号长度需在 1~100 之间' })
  account!: string
}

/**
 * 用验证码重置密码
 *
 * 新密码这里只做「非空 + 长度」的粗校验，真正的强度规则走 `assertPasswordStrength`
 * （长度/复杂度阈值都在 sys_config 里，硬编码在 DTO 上会和配置中心打架）。
 */
export class ResetByCodeDto {
  @ApiProperty({ description: '登录账号或账号绑定的邮箱', example: 'zhangsan' })
  @IsString()
  @Length(1, 100, { message: '账号长度需在 1~100 之间' })
  account!: string

  @ApiProperty({ description: '邮件收到的 6 位验证码', example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: '验证码须为 6 位数字' })
  code!: string

  @ApiProperty({ description: '新密码（长度与复杂度由系统参数决定）', example: 'N7#vQm2Lp' })
  @IsString()
  @MinLength(8, { message: '新密码至少 8 位' })
  @MaxLength(128, { message: '新密码最长 128 位' })
  newPassword!: string
}
