import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, Length } from 'class-validator'

export class CreateMenuDto {
  @ApiProperty({ description: '菜单名称', example: '用户管理' })
  @IsString()
  @Length(1, 32)
  name: string

  @ApiProperty({ description: '类型：0 目录 / 1 菜单 / 2 按钮', example: 1, enum: [0, 1, 2] })
  @IsInt()
  @IsIn([0, 1, 2])
  type: number

  @ApiPropertyOptional({ description: '路由路径', example: '/system/user' })
  @IsOptional()
  @IsString()
  path?: string

  @ApiPropertyOptional({ description: '前端组件路径', example: 'system/user/index' })
  @IsOptional()
  @IsString()
  component?: string

  @ApiPropertyOptional({ description: '图标', example: 'user' })
  @IsOptional()
  @IsString()
  icon?: string

  @ApiPropertyOptional({ description: '权限标识（按钮级，如 system:user:add）', example: 'system:user:list' })
  @IsOptional()
  @IsString()
  permission?: string

  @ApiPropertyOptional({ description: '父级菜单 ID，0 为顶级', example: 0 })
  @IsOptional()
  @IsInt()
  parentId?: number

  @ApiPropertyOptional({ description: '排序号，越小越靠前', example: 0 })
  @IsOptional()
  @IsInt()
  sort?: number

  @ApiPropertyOptional({ description: '状态：0 禁用 / 1 启用', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  status?: number
}
