import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator'

/** 创建字典项（对齐 JeecgBoot sys_dict_item 字段） */
export class CreateDictItemDto {
  @ApiProperty({ description: '所属字典 ID（sys_dict.id）', example: 'dict_1' })
  @IsString()
  @Length(1, 32, { message: '字典 ID 长度必须在 1~32 之间' })
  dictId: string

  @ApiProperty({ description: '字典项文本（展示用）', example: '男' })
  @IsString()
  @Length(1, 100, { message: '字典项文本长度必须在 1~100 之间' })
  itemText: string

  @ApiProperty({ description: '字典项值（存储用，同一字典下唯一）', example: '1' })
  @IsString()
  @Length(1, 100, { message: '字典项值长度必须在 1~100 之间' })
  itemValue: string

  @ApiPropertyOptional({ description: '排序，越小越靠前', example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number

  @ApiPropertyOptional({ description: '状态：1 启用 / 0 不启用', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1], { message: '状态只能是 0（不启用）或 1（启用）' })
  status?: number

  @ApiPropertyOptional({ description: '描述', example: '男性' })
  @IsOptional()
  @IsString()
  @Length(0, 255, { message: '描述最长 255 个字符' })
  description?: string
}
