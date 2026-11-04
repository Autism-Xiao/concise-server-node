import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator'

export class CreatePostDto {
  @ApiProperty({ description: '岗位编码（唯一）', example: 'dev_engineer' })
  @IsString()
  @Length(2, 100)
  postCode: string

  @ApiProperty({ description: '岗位名称', example: '研发工程师' })
  @IsString()
  @Length(1, 100)
  postName: string

  @ApiPropertyOptional({ description: '排序', example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  postSort?: number

  @ApiPropertyOptional({ description: '所属部门 ID（sys_depart.id），不传为未分配', example: 'dept_1' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  deptId?: string | null

  @ApiPropertyOptional({ description: '状态：1 正常 / 0 停用', example: '1' })
  @IsOptional()
  @IsString()
  @Length(1, 1)
  status?: string

  @ApiPropertyOptional({ description: '描述', example: '负责服务端研发' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string
}
