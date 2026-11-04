import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, Length, MaxLength } from 'class-validator'

export class CreateMenuDto {
  @ApiProperty({ description: '菜单标题', example: '用户管理' })
  @IsString()
  @Length(1, 255)
  name: string

  @ApiProperty({ description: '菜单类型：0 一级菜单 / 1 子菜单 / 2 按钮权限', example: 1, enum: [0, 1, 2] })
  @IsInt()
  @IsIn([0, 1, 2])
  menuType: number

  @ApiPropertyOptional({ description: '父级 ID，不传为顶级', example: 'menu_1' })
  @IsOptional()
  @IsString()
  parentId?: string | null

  @ApiPropertyOptional({ description: '路由路径', example: '/system/user' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  url?: string

  @ApiPropertyOptional({ description: '前端组件路径', example: 'system/user/index' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  component?: string

  @ApiPropertyOptional({ description: '组件名', example: 'system-user' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  componentName?: string

  @ApiPropertyOptional({ description: '图标', example: 'user' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  icon?: string

  @ApiPropertyOptional({ description: '权限编码（按钮级，如 system:user:add）', example: 'system:user:add' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  perms?: string

  @ApiPropertyOptional({ description: '菜单排序', example: 1 })
  @IsOptional()
  @IsInt()
  sortNo?: number

  @ApiPropertyOptional({ description: '是否路由菜单：0 否 / 1 是', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  isRoute?: number

  @ApiPropertyOptional({ description: '一级菜单跳转地址', example: '/system/user' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  redirect?: string

  @ApiPropertyOptional({ description: '是否隐藏路由：0 否 / 1 是', example: 0, enum: [0, 1] })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  hidden?: number

  @ApiPropertyOptional({ description: '状态：0 无效 / 1 有效', example: '1', enum: ['0', '1'] })
  @IsOptional()
  @IsString()
  @IsIn(['0', '1'])
  status?: string

  @ApiPropertyOptional({ description: '描述' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string
}
