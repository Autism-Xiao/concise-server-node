import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, Max, Min } from 'class-validator'

/** 平台「即将到期」租户查询参数：只给天数窗口，不分页（临期租户量级很小，一次带回） */
export class QueryExpiringTenantDto {
  @ApiPropertyOptional({ description: '到期窗口天数：含今天在内、未来 N 天内到期（已到期未停用的也会带上，daysLeft 为负）', example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number
}
