import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, Length } from 'class-validator'

/** 字典列表查询（字典类型数量少，一次全量返回，不做分页） */
export class QueryDictDto {
  @ApiPropertyOptional({ description: '关键字：模糊匹配字典名称 / 编码', example: 'gender' })
  @IsOptional()
  @IsString()
  @Length(0, 100)
  keyword?: string
}
