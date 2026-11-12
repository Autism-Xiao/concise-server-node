import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, Length, Matches } from 'class-validator'

/** 创建字典 */
export class CreateDictDto {
  @ApiProperty({ description: '字典名称', example: '用户性别' })
  @IsString()
  @Length(1, 100, { message: '字典名称长度必须在 1~100 之间' })
  dictName: string

  @ApiProperty({ description: '字典编码（唯一，字母开头，可含数字/下划线/冒号）', example: 'sys_user_gender' })
  @IsString()
  @Length(1, 100, { message: '字典编码长度必须在 1~100 之间' })
  @Matches(/^[a-zA-Z][a-zA-Z0-9_:.-]*$/, { message: '字典编码必须以字母开头，只能包含字母、数字、下划线、冒号、点、短横线' })
  dictCode: string

  @ApiPropertyOptional({ description: '字典值类型：0 string / 1 number', example: 0, enum: [0, 1] })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1], { message: '字典类型只能是 0（string）或 1（number）' })
  type?: number

  @ApiPropertyOptional({ description: '描述', example: '用户性别字典' })
  @IsOptional()
  @IsString()
  @Length(0, 255, { message: '描述最长 255 个字符' })
  description?: string
}
