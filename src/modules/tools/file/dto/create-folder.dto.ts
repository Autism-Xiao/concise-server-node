import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator'

/** 名称里不允许出现路径分隔符和控制字符（否则拼磁盘路径时会穿越 / 破坏文件名） */
// eslint-disable-next-line no-control-regex -- 必须显式排除 \u0000-\u001f 控制字符
export const FILE_NAME_PATTERN = /^[^\\/:*?"<>|\u0000-\u001f]+$/

export class CreateFolderDto {
  @ApiPropertyOptional({ description: '父目录 ID，0 或不传表示根目录', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'parentId 必须是数字' })
  @Min(0, { message: 'parentId 不能为负数' })
  parentId?: number

  @ApiProperty({ description: '文件夹名称', example: '合同归档' })
  @IsString({ message: '文件夹名称必须是字符串' })
  @Length(1, 100, { message: '文件夹名称长度需在 1-100 之间' })
  @Matches(FILE_NAME_PATTERN, { message: '名称不能包含 \\ / : * ? " < > | 等特殊字符' })
  name: string
}
