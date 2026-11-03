import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator'

import { PagerDto } from '../../../common/dto/pager.dto'

/** 用户列表查询参数 */
export class QueryUserDto extends PagerDto {
  @ApiPropertyOptional({ description: '关键字：模糊匹配用户名/昵称', example: '张' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  keyword?: string

  @ApiPropertyOptional({ description: '状态过滤：0 禁用 / 1 启用', example: '1', enum: ['0', '1'] })
  @IsOptional()
  @IsString()
  status?: string

  @ApiPropertyOptional({ description: '部门 ID 过滤', example: 1, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  deptId?: number
}
