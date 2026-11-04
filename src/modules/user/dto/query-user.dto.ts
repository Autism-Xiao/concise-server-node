import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength } from 'class-validator'

import { PagerDto } from '../../../common/dto/pager.dto'

/** 用户列表查询参数 */
export class QueryUserDto extends PagerDto {
  @ApiPropertyOptional({ description: '关键字：模糊匹配用户名/真实姓名/手机号', example: '张' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  keyword?: string

  @ApiPropertyOptional({ description: '状态过滤：1 正常 / 2 冻结', example: '1', enum: ['1', '2'] })
  @IsOptional()
  @IsString()
  status?: string

  @ApiPropertyOptional({ description: '部门 ID 过滤（sys_depart.id）', example: 'dept_1' })
  @IsOptional()
  @IsString()
  deptId?: string
}
