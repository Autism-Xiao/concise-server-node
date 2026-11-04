import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator'

export class CreateLevelDto {
  @ApiProperty({ description: '职级名称（如 P6 / M1，唯一）', example: 'P6' })
  @IsString()
  @Length(1, 100)
  levelName: string

  @ApiPropertyOptional({ description: '等级数值，数字越大级别越高', example: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  levelRank?: number

  @ApiPropertyOptional({ description: '状态：1 正常 / 0 停用', example: '1' })
  @IsOptional()
  @IsString()
  @Length(1, 1)
  status?: string

  @ApiPropertyOptional({ description: '备注', example: '高级工程师' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  remark?: string
}
