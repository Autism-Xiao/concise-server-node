import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'
import { PagerDto } from '../../../../common/dto/pager.dto'

export class QueryLevelDto extends PagerDto {
  @ApiPropertyOptional({ description: '关键字，模糊匹配职级名称/备注', example: 'P6' })
  @IsOptional()
  @IsString()
  keyword?: string
}
