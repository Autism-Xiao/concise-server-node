import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator'

import { PagerDto } from '../../../../common/dto/pager.dto'

/** 管理端公告列表查询条件 */
export class QueryNoticeDto extends PagerDto {
  @ApiPropertyOptional({ description: '标题/内容模糊过滤', example: '上线' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string

  @ApiPropertyOptional({ description: '消息类型：1 通知公告 / 2 系统消息', example: '1', enum: ['1', '2'] })
  @IsOptional()
  @IsIn(['1', '2'])
  @Type(() => String)
  msgCategory?: string

  @ApiPropertyOptional({ description: '发布状态：0 未发布 / 1 已发布 / 2 已撤销', example: '1', enum: ['0', '1', '2'] })
  @IsOptional()
  @IsIn(['0', '1', '2'])
  @Type(() => String)
  sendStatus?: string

  @ApiPropertyOptional({ description: '优先级：L / M / H', example: 'H', enum: ['L', 'M', 'H'] })
  @IsOptional()
  @IsIn(['L', 'M', 'H'])
  priority?: string

  @ApiPropertyOptional({ description: '创建时间起（ISO 8601，含）', example: '2026-11-01T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601({}, { message: 'startTime 须为 ISO 8601 日期' })
  startTime?: string

  @ApiPropertyOptional({ description: '创建时间止（ISO 8601，含）', example: '2026-11-30T23:59:59.000Z' })
  @IsOptional()
  @IsISO8601({}, { message: 'endTime 须为 ISO 8601 日期' })
  endTime?: string
}
