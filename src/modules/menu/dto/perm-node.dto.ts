import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsInt, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator'

/** 单个按钮权限节点（穿梭框右栏的每一项） */
export class PermNodeDto {
  @ApiProperty({ description: '按钮名称', example: '查询' })
  @IsString()
  @Length(1, 255)
  name: string

  @ApiProperty({ description: '权限标识（按钮级，如 system:user:list）', example: 'system:user:list' })
  @IsString()
  @Length(1, 255)
  perms: string

  @ApiPropertyOptional({ description: '排序号（默认按提交顺序）', example: 1 })
  @IsOptional()
  @IsInt()
  sortNo?: number
}

/** PUT /v1/menus/:id/perm-nodes 全量替换某菜单下的按钮权限节点 */
export class SavePermNodesDto {
  @ApiProperty({ description: '按钮权限节点全量列表（未列出的既有按钮会被软删除）', type: [PermNodeDto] })
  @ArrayMaxSize(30, { message: '按钮权限节点最多 30 个' })
  @ValidateNested({ each: true })
  @Type(() => PermNodeDto)
  nodes: PermNodeDto[]

  @ApiPropertyOptional({ description: '操作人账号（审计用，可省略）' })
  @IsOptional()
  @MaxLength(255)
  operateBy?: string
}
