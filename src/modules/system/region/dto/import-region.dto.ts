import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { CreateRegionDto } from './create-region.dto'

/** 批量导入条目：与 CreateRegionDto 同构（含 pid 可选，兼容第三方区划库原始 JSON） */
export class ImportRegionItemDto extends PartialType(CreateRegionDto) {
  @ApiPropertyOptional({ description: '父级 ID（第三方数据冗余字段，可不传）', example: 0 })
  pid?: number

  @ApiPropertyOptional({ description: '层级文本（导入时以 level 推导为准）', example: '城市' })
  levelText?: string

  @ApiPropertyOptional({ description: '第三方数据主键 id（导入时忽略，由本系统生成）' })
  id?: number
}

export class ImportRegionDto {
  @ApiProperty({ description: '区划数据数组（按 areaCode 去重，存在则更新）', type: [ImportRegionItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: '至少一条数据' })
  @ArrayMaxSize(5000, { message: '单次最多导入 5000 条，请分批' })
  @ValidateNested({ each: true })
  @Type(() => ImportRegionItemDto)
  regions: ImportRegionItemDto[]
}
