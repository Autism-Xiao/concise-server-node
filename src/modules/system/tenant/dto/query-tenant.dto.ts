import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class QueryTenantDto {
  @ApiPropertyOptional({ description: '关键字，模糊匹配租户名称/编码/联系人' })
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional({ description: '状态：0 正常 / 1 停用', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  status?: number

  @ApiPropertyOptional({ description: '页码', example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  current?: number

  @ApiPropertyOptional({ description: '每页条数', example: 10, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  size?: number
}
