import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Length } from 'class-validator'

export class CreateRoleDto {
  @ApiProperty({ description: '角色标识（英文，用于 @Roles() 匹配）', example: 'admin' })
  @IsString()
  @Length(2, 32)
  name: string

  @ApiProperty({ description: '角色名称（中文展示）', example: '管理员' })
  @IsString()
  @Length(1, 32)
  label: string

  @ApiPropertyOptional({ description: '状态：0 禁用 / 1 启用', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsInt()
  status?: number

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  remark?: string

  @ApiPropertyOptional({ description: '授权菜单 ID 列表', type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Type(() => Number)
  menuIds?: number[]
}
