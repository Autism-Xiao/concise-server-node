import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator'

import { PagerDto } from '../../../../common/dto/pager.dto'

/** 文件分类过滤（前端展示用英文，后端按扩展名映射） */
export const FILE_KINDS = ['all', 'image', 'document', 'video', 'audio', 'other'] as const
export type FileKind = (typeof FILE_KINDS)[number]

/** 排序字段：名称 / 大小 / 修改时间（文件夹始终排在最前） */
export const FILE_SORTS = ['name', 'size', 'time'] as const

export class QueryFileDto extends PagerDto {
  @ApiPropertyOptional({ description: '父目录 ID，0 或不传表示根目录', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'parentId 必须是数字' })
  @Min(0, { message: 'parentId 不能为负数' })
  parentId?: number

  @ApiPropertyOptional({ description: '按名称模糊搜索（仅当前目录）', example: '报告' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string

  @ApiPropertyOptional({ description: '分类过滤', enum: FILE_KINDS, default: 'all' })
  @IsOptional()
  @IsIn(FILE_KINDS as unknown as string[], { message: 'kind 取值不合法' })
  kind?: FileKind

  @ApiPropertyOptional({ description: '只看星标', example: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  starred?: boolean

  @ApiPropertyOptional({ description: '排序字段', enum: FILE_SORTS, default: 'time' })
  @IsOptional()
  @IsIn(FILE_SORTS as unknown as string[], { message: 'sort 取值不合法' })
  sort?: 'name' | 'size' | 'time'

  @ApiPropertyOptional({ description: '排序方向', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'order 只能是 asc 或 desc' })
  order?: 'asc' | 'desc'
}
