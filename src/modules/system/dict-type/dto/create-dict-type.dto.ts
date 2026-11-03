import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator'

export class CreateDictTypeDto {
  @ApiProperty({ description: '字典类型名称', example: '用户性别', maxLength: 32 })
  @IsString()
  @Length(1, 32, { message: '名称长度须在 1~32 位之间' })
  name: string

  @ApiProperty({ description: '字典编码（唯一，小写字母/数字/下划线）', example: 'sys_user_gender' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,63}$/, { message: '编码须为小写字母开头的字母/数字/下划线，2~64 位' })
  code: string

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
