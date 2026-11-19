import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { PagerDto } from '../../../../common/dto/pager.dto'

export class QueryTenantDto extends PagerDto {
  @ApiPropertyOptional({ description: '关键字，模糊匹配租户名称/编码/联系人' })
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional({ description: '状态：0 正常 / 1 停用', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  status?: number

  /**
   * 兼容旧参数名（current/size）
   *
   * 早期这个接口自己定义了一套分页字段，与全站 PagerDto（page/pageSize）不一致。
   * 现在统一按 page/pageSize，旧名保留一个版本，免得上一个版本的前端页面在
   * 灰度期间翻页失灵；service 里 page ?? current 兜底。
   *
   * @deprecated 改用 page / pageSize
   */
  @ApiPropertyOptional({ description: '页码（旧参数，等价 page）', deprecated: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  current?: number

  @ApiPropertyOptional({ description: '每页条数（旧参数，等价 pageSize）', deprecated: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  size?: number
}
