import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'

export class QueryPostDto {
  @ApiPropertyOptional({ description: '关键字，模糊匹配岗位名称/编码/描述', example: '研发' })
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional({ description: '按部门过滤（含该部门下岗位）', example: 'dept_1' })
  @IsOptional()
  @IsString()
  deptId?: string
}
