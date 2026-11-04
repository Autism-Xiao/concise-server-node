import { ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator'

import { PagerDto } from '../../../common/dto/pager.dto'

/** 存储记录分页查询 DTO */
export class QueryStorageDto extends PagerDto {
  @ApiPropertyOptional({ description: '文件名模糊过滤', example: 'logo' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string

  @ApiPropertyOptional({ description: '文件类型过滤', example: '图片', enum: ['图片', '文档', '音乐', '视频', '其他'] })
  @IsOptional()
  @IsIn(['图片', '文档', '音乐', '视频', '其他'])
  type?: string
}

/** 批量删除 DTO */
export class DeleteStorageDto {
  @ApiPropertyOptional({ description: '要删除的文件记录 ID 列表', example: [1] })
  @IsArray()
  @ArrayNotEmpty({ message: 'ids 不能为空' })
  @IsInt({ each: true })
  ids: number[]
}
