import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, Length } from 'class-validator'

export class CreateNoticeDto {
  @ApiProperty({ description: '公告标题', example: '系统上线通知', maxLength: 64 })
  @IsString()
  @Length(1, 64, { message: '标题长度须在 1~64 位之间' })
  title: string

  @ApiProperty({ description: '类型：1 通知 / 2 公告', example: 1, enum: [1, 2] })
  @IsIn([1, 2], { message: '类型只能是 1（通知）或 2（公告）' })
  type: number

  @ApiPropertyOptional({ description: '公告内容（富文本）' })
  @IsOptional()
  @IsString()
  content?: string

  @ApiPropertyOptional({ description: '状态：0 草稿 / 1 直接发布', example: 0, enum: [0, 1] })
  @IsOptional()
  @IsIn([0, 1])
  status?: number
}
