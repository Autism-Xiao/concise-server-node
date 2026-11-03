import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator'

export class CreateDictItemDto {
  @ApiProperty({ description: '字典标签（展示用）', example: '男', maxLength: 32 })
  @IsString()
  @Length(1, 32, { message: '标签长度须在 1~32 位之间' })
  label: string

  @ApiProperty({ description: '字典值（同一类型下唯一）', example: '1', maxLength: 64 })
  @IsString()
  @Length(1, 64, { message: '值长度须在 1~64 位之间' })
  value: string

  @ApiProperty({ description: '所属字典类型 ID', example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  dictTypeId: number

  @ApiPropertyOptional({ description: '排序号，越小越靠前', example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number

  @ApiPropertyOptional({ description: '状态：0 禁用 / 1 启用', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsIn([0, 1])
  status?: number

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string
}
