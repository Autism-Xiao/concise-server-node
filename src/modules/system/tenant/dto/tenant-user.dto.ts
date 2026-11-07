import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayNotEmpty, IsArray, IsInt, IsOptional, IsString } from 'class-validator'
import { Type } from 'class-transformer'

export class AssignUsersDto {
  @ApiProperty({ description: '该租户下的用户 ID 全集（覆盖式：不在列表里的会被移除）', type: [String] })
  @IsArray()
  @IsString({ each: true })
  userIds: string[]
}

export class SwitchTenantDto {
  @ApiProperty({ description: '目标租户 ID；0 表示回到平台视角（仅超管）', example: 1 })
  @Type(() => Number)
  @IsInt()
  tenantId: number
}

export class QueryTenantUserDto {
  @ApiPropertyOptional({ description: '关键字，模糊匹配用户名/姓名' })
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional({ description: '页码', example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  current?: number

  @ApiPropertyOptional({ description: '每页条数', example: 10, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  size?: number
}

export class AddUsersDto {
  @ApiProperty({ description: '要加入该租户的用户 ID 列表', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  userIds: string[]
}
