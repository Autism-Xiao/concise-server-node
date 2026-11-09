import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, Length } from 'class-validator'

/**
 * 为租户建管理员账号
 *
 * 只收最小必要字段：账号/姓名/密码。角色不用传 —— 固定绑该租户的 admin 角色，
 * 避免调用方传错角色把「建管理员」变成「随便建个号」。
 */
export class CreateTenantAdminDto {
  @ApiProperty({ description: '登录账号（全局唯一，3~100 位）', example: 'admin_sz', minLength: 3, maxLength: 100 })
  @IsString()
  @Length(3, 100, { message: '用户名长度须在 3~100 位之间' })
  username: string

  @ApiProperty({ description: '真实姓名', example: '深圳管理员', maxLength: 100 })
  @IsString()
  @Length(1, 100, { message: '姓名长度须在 1~100 位之间' })
  realname: string

  @ApiProperty({ description: '初始密码（6~64 位明文，服务端哈希后入库）', example: 'Sz@123456', minLength: 6, maxLength: 64 })
  @IsString()
  @Length(6, 64, { message: '密码长度须在 6~64 位之间' })
  password: string

  @ApiPropertyOptional({ description: '状态：1 正常 / 2 冻结，默认 1', example: 1, enum: [1, 2] })
  @IsOptional()
  @IsIn([1, 2], { message: '状态只能是 1（正常）或 2（冻结）' })
  status?: number
}
