import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsDateString, IsEmail, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator'

/**
 * 自助更新个人资料入参（PUT /v1/users/me）
 *
 * 只开放「本人可改」的字段。账号、工号、状态、角色、部门、密码都有各自的专用接口，
 * 即使前端硬塞进来也会被全局 ValidationPipe 的 whitelist 丢掉，不会越权改到。
 *
 * 空串语义 = 清空该字段（邮箱/手机号/座机/生日/简介），所以这些字段用 ValidateIf 放行空串，
 * 避免用户想删掉邮箱时被「邮箱格式不正确」挡住。
 */
export class UpdateMyProfileDto {
  @ApiPropertyOptional({ description: '真实姓名（1~100 字符）', example: '张三' })
  @IsOptional()
  @IsString({ message: '姓名必须是字符串' })
  @MaxLength(100, { message: '姓名最多 100 个字符' })
  realname?: string

  @ApiPropertyOptional({ description: '邮箱（唯一，空串表示清空）', example: 'zhangsan@test.com', maxLength: 45 })
  @IsOptional()
  @IsString()
  @ValidateIf(o => String(o?.email ?? '') !== '')
  @IsEmail({}, { message: '邮箱格式不正确' })
  @MaxLength(45, { message: '邮箱最多 45 个字符' })
  email?: string

  @ApiPropertyOptional({ description: '手机号（唯一，空串表示清空）', example: '18611111111', maxLength: 45 })
  @IsOptional()
  @IsString()
  @MaxLength(45, { message: '手机号最多 45 个字符' })
  phone?: string

  @ApiPropertyOptional({ description: '座机号（空串表示清空）', example: '010-88886666', maxLength: 45 })
  @IsOptional()
  @IsString()
  @MaxLength(45, { message: '座机号最多 45 个字符' })
  telephone?: string

  @ApiPropertyOptional({ description: '性别：0 未知 / 1 男 / 2 女', enum: [0, 1, 2], example: 1 })
  @IsOptional()
  @IsIn([0, 1, 2], { message: '性别只允许 0（未知）/ 1（男）/ 2（女）' })
  @Type(() => Number)
  sex?: number

  @ApiPropertyOptional({ description: '生日（YYYY-MM-DD；空串表示清空）', example: '1992-03-08' })
  @IsOptional()
  @IsString()
  @ValidateIf(o => String(o?.birthday ?? '') !== '')
  @IsDateString({}, { message: '生日须为合法日期（YYYY-MM-DD）' })
  birthday?: string

  @ApiPropertyOptional({ description: '个人简介（最多 255 字符；空串表示清空）', example: '做后台的，顺手写点前端。' })
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: '个人简介最多 255 个字符' })
  bio?: string | null
}
