import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator'

import { TENANT_PLAN } from '../entities/tenant.entity'

const PLAN_VALUES = Object.values(TENANT_PLAN)

export class CreateTenantDto {
  @ApiProperty({ description: '租户名称', example: '某某科技有限公司' })
  @IsString()
  @Length(1, 100)
  name: string

  @ApiProperty({ description: '租户编码（唯一，字母数字下划线）', example: 'acme' })
  @IsString()
  @Length(2, 64)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: '租户编码只能包含字母、数字、下划线和短横线' })
  code: string

  @ApiPropertyOptional({ description: '联系人', example: '张三' })
  @IsOptional()
  @IsString()
  @Length(0, 50)
  contact?: string

  @ApiPropertyOptional({ description: '联系电话', example: '13800000000' })
  @IsOptional()
  @IsString()
  @Length(0, 30)
  phone?: string

  @ApiPropertyOptional({ description: '套餐：trial / standard / enterprise', enum: PLAN_VALUES, example: 'standard' })
  @IsOptional()
  @IsIn(PLAN_VALUES)
  plan?: string

  @ApiPropertyOptional({ description: '开通日期 YYYY-MM-DD', example: '2026-01-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '开通日期格式应为 YYYY-MM-DD' })
  beginDate?: string

  @ApiPropertyOptional({ description: '到期日期 YYYY-MM-DD（空=永久）', example: '2027-01-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '到期日期格式应为 YYYY-MM-DD' })
  expireAt?: string

  @ApiPropertyOptional({ description: '状态：0 正常 / 1 停用', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1)
  status?: number

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  remark?: string
}
