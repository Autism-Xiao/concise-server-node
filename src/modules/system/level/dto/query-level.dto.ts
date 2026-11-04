import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'

export class QueryLevelDto {
  @ApiPropertyOptional({ description: '关键字，模糊匹配职级名称/备注', example: 'P6' })
  @IsOptional()
  @IsString()
  keyword?: string
}
