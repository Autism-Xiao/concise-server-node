import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength } from 'class-validator'

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
}
