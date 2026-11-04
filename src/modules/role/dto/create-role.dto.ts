import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsOptional, IsString, Length } from 'class-validator'

export class CreateRoleDto {
  @ApiProperty({ description: '角色名称（中文展示）', example: '运营' })
  @IsString()
  @Length(1, 200)
  roleName: string

  @ApiProperty({ description: '角色编码（英文，用于 @Roles() 匹配，唯一）', example: 'operator' })
  @IsString()
  @Length(2, 100)
  roleCode: string

  @ApiPropertyOptional({ description: '描述', example: '运营角色，可管理公告与任务' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  description?: string

  @ApiPropertyOptional({ description: '授权菜单/按钮 ID 列表（sys_permission.id）；空数组表示清空授权', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  menuIds?: string[]
}
