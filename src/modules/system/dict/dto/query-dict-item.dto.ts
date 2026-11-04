import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Length } from 'class-validator'

import { PagerDto } from '../../../../common/dto/pager.dto'

/** 字典项列表查询（分页） */
export class QueryDictItemDto extends PagerDto {
  @ApiPropertyOptional({ description: '所属字典 ID', example: 'dict_1' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  dictId?: string

  @ApiPropertyOptional({ description: '关键字：模糊匹配字典项文本 / 值', example: '男' })
  @IsOptional()
  @IsString()
  @Length(0, 100)
  keyword?: string

  @ApiPropertyOptional({ description: '状态过滤：1 启用 / 0 不启用', example: 1, enum: [0, 1] })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1], { message: '状态只能是 0（不启用）或 1（启用）' })
  status?: number
}
