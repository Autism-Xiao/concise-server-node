import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsArray, IsIn, IsOptional, IsString, Length } from 'class-validator'

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

  @ApiPropertyOptional({ description: '数据范围：1 全部 / 2 本部门及以下 / 3 本部门 / 4 仅本人（默认 1）', example: 1, enum: [1, 2, 3, 4] })
  @IsOptional()
  @IsIn([1, 2, 3, 4], { message: '数据范围只允许 1/2/3/4' })
  @Type(() => Number)
  dataScope?: number

  @ApiPropertyOptional({ description: '状态：1 正常 / 0 停用（默认 1；停用后角色不再参与权限计算）', example: 1, enum: [1, 0] })
  @IsOptional()
  @IsIn([0, 1], { message: '状态只允许 0（停用）/ 1（正常）' })
  @Type(() => Number)
  status?: number

  @ApiPropertyOptional({ description: '授权菜单/按钮 ID 列表（sys_permission.id）；空数组表示清空授权', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  menuIds?: string[]
}
