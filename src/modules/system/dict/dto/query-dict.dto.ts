import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, Length } from 'class-validator'
import { PagerDto } from '../../../../common/dto/pager.dto'

/** 字典列表查询：走统一分页，配合前端服务端搜索/排序 */
export class QueryDictDto extends PagerDto {
  @ApiPropertyOptional({ description: '关键字：模糊匹配字典名称 / 编码', example: 'gender' })
  @IsOptional()
  @IsString()
  @Length(0, 100)
  keyword?: string
}
