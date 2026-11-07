import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator'

import { FILE_NAME_PATTERN } from './create-folder.dto'

/** 文件/文件夹的局部更新：改名、移动、星标，三者可单独或一起传 */
export class UpdateFileDto {
  @ApiPropertyOptional({ description: '新名称（含扩展名）', example: '年度报告-终版.xlsx' })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: '名称长度需在 1-255 之间' })
  @Matches(FILE_NAME_PATTERN, { message: '名称不能包含 \\ / : * ? " < > | 等特殊字符' })
  name?: string

  @ApiPropertyOptional({ description: '移动到的目标目录 ID，0 表示根目录', example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'parentId 必须是数字' })
  @Min(0, { message: 'parentId 不能为负数' })
  parentId?: number

  @ApiPropertyOptional({ description: '星标状态', example: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'starred 必须是布尔值' })
  starred?: boolean
}
