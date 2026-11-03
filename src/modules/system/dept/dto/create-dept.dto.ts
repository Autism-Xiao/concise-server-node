import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, MaxLength, Min } from 'class-validator'

export class CreateDeptDto {
  @ApiProperty({ description: '部门名称', example: '研发部', maxLength: 32 })
  @IsString()
  @Length(1, 32, { message: '部门名称长度须在 1~32 位之间' })
  name: string

  @ApiProperty({ description: '父级部门 ID，0 为顶级', example: 0, minimum: 0 })
  @IsInt({ message: '父级部门 ID 必须是整数' })
  @Min(0)
  parentId: number

  @ApiPropertyOptional({ description: '排序号，越小越靠前', example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number

  @ApiPropertyOptional({ description: '负责人', example: '张三' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  leader?: string

  @ApiPropertyOptional({ description: '联系电话', example: '13800138000' })
  @IsOptional()
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone?: string

  @ApiPropertyOptional({ description: '状态：0 禁用 / 1 启用', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsIn([0, 1])
  status?: number
}
