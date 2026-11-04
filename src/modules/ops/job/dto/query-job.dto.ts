import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator'

import { PagerDto } from '../../../../common/dto/pager.dto'

/** 定时任务列表查询 */
export class QueryJobDto extends PagerDto {
  @ApiPropertyOptional({ description: '关键字：模糊匹配任务类名 / 描述' })
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional({ description: '状态：0 正常 / -1 停止', enum: [0, -1] })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([0, -1], { message: '状态只能是 0（正常）或 -1（停止）' })
  status?: number
}
