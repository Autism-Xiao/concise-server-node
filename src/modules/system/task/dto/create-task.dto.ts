import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Min } from 'class-validator'

export class CreateTaskDto {
  @ApiProperty({ description: '任务标题', example: '整理需求文档', maxLength: 64 })
  @IsString()
  @Length(1, 64, { message: '标题长度须在 1~64 位之间' })
  title: string

  @ApiPropertyOptional({ description: '任务描述' })
  @IsOptional()
  @IsString()
  description?: string

  @ApiPropertyOptional({ description: '优先级：0 低 / 1 中 / 2 高', example: 1, enum: [0, 1, 2] })
  @IsOptional()
  @IsIn([0, 1, 2])
  priority?: number

  @ApiPropertyOptional({ description: '负责人用户 ID，0 为未指派', example: 1, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  assigneeId?: number

  @ApiPropertyOptional({ description: '截止时间（ISO 8601 字符串，校验后由 Service 转 Date）', example: '2026-12-01T00:00:00Z' })
  @IsOptional()
  @IsISO8601({}, { message: '截止时间须为 ISO 8601 格式' })
  dueDate?: string
}
