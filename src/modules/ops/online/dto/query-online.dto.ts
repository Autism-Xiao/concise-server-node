import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'

import { PagerDto } from '../../../../common/dto/pager.dto'

/** 在线用户列表查询 */
export class QueryOnlineDto extends PagerDto {
  @ApiPropertyOptional({ description: '关键字：模糊匹配账号 / 部门 / IP / 归属地 / 浏览器 / 系统' })
  @IsOptional()
  @IsString()
  keyword?: string
}
