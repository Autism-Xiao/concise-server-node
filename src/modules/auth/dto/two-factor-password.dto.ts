import { ApiProperty } from '@nestjs/swagger'
import { IsString, MaxLength, MinLength } from 'class-validator'

/**
 * 两步验证敏感操作（绑定 / 解绑）的密码确认
 *
 * 为什么光有登录态还不够：setup 是**覆盖式**写密钥 —— 拿到被盗会话（token）的人
 * 可以直接调 setup 把自己的认证器绑到别人账号上，然后 activate 成功，原主人反而被
 * 锁在外面（连「关掉 2FA」都要先过攻击者掌握的动态码）。加一道密码二次确认后，
 * 仅凭 token 泄露不再能接管 2FA。
 */
export class TwoFactorPasswordDto {
  @ApiProperty({ description: '当前账号密码（敏感操作二次确认）', example: '••••••••' })
  @IsString()
  @MinLength(1, { message: '请输入当前密码确认操作' })
  @MaxLength(128)
  password: string
}

export class TwoFactorDeactivateDto extends TwoFactorPasswordDto {
  @ApiProperty({ description: '6 位动态码', example: '123456' })
  @IsString()
  @MinLength(6, { message: '动态码格式不正确' })
  @MaxLength(12, { message: '动态码格式不正确' })
  code: string
}
