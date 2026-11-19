import { Type } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

/**
 * 通用分页参数基类
 * 业务列表 DTO 继承此类即可获得分页参数与校验
 */
export class PagerDto {
  @ApiPropertyOptional({ description: '页码，从 1 开始', example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({ description: '每页条数，最大 100', example: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number

  /**
   * 排序字段（前端列 id）
   *
   * 只有各列表 service 的白名单里有的字段才生效，其余静默回落到默认排序 ——
   * 这样前端可以统一把表头排序状态丢上来，不用为每个列表核对字段名。
   */
  @ApiPropertyOptional({ description: '排序字段（列 id，需在该列表白名单内）', example: 'createTime' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  sortBy?: string

  @ApiPropertyOptional({ description: '排序方向：asc 升序 / desc 降序', enum: ['asc', 'desc'], example: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc'
}
