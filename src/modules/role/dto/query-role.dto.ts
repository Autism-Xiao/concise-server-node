import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString } from 'class-validator'
import { PagerDto } from '../../../common/dto/pager.dto'

export class QueryRoleDto extends PagerDto {
  @ApiPropertyOptional({ description: '关键字，模糊匹配角色名称/角色编码', example: '管理' })
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional({ description: '按归属租户过滤：0 = 平台共享，>0 = 指定租户（不传则全部）', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  tenantId?: number
}
