import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsISO8601, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator'

/** 创建通知公告（字段对齐 JeecgBoot sys_announcement） */
export class CreateNoticeDto {
  @ApiProperty({ description: '标题', example: '系统 V1.0 上线', maxLength: 100 })
  @IsString()
  @Length(1, 100, { message: '标题长度须在 1~100 位之间' })
  title: string

  @ApiPropertyOptional({ description: '内容（富文本或纯文本）', example: '本次上线包含用户/角色/菜单管理' })
  @IsOptional()
  @IsString()
  @MaxLength(20000, { message: '内容长度不能超过 20000 位' })
  msgContent?: string

  @ApiPropertyOptional({ description: '消息类型：1 通知公告 / 2 系统消息', example: '1', enum: ['1', '2'] })
  @IsOptional()
  @IsIn(['1', '2'], { message: '消息类型只能是 1（通知公告）或 2（系统消息）' })
  msgCategory?: string

  @ApiPropertyOptional({ description: '通告对象类型：ALL 全体用户 / USER 指定用户', example: 'ALL', enum: ['ALL', 'USER'] })
  @IsOptional()
  @IsIn(['ALL', 'USER'], { message: '通告对象只能是 ALL（全体用户）或 USER（指定用户）' })
  msgType?: string

  @ApiPropertyOptional({ description: '优先级：L 低 / M 中 / H 高', example: 'M', enum: ['L', 'M', 'H'] })
  @IsOptional()
  @IsIn(['L', 'M', 'H'], { message: '优先级只能是 L / M / H' })
  priority?: string

  @ApiPropertyOptional({ description: '发布状态：0 未发布（存草稿）/ 1 创建后直接发布', example: '0', enum: ['0', '1'] })
  @IsOptional()
  @IsIn(['0', '1'], { message: '发布状态只能是 0（未发布）或 1（已发布）' })
  sendStatus?: string

  @ApiPropertyOptional({ description: '生效开始时间（ISO 8601）', example: '2026-11-01T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601({}, { message: 'startTime 须为 ISO 8601 日期' })
  startTime?: string

  @ApiPropertyOptional({ description: '生效结束时间（ISO 8601）', example: '2026-12-01T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601({}, { message: 'endTime 须为 ISO 8601 日期' })
  endTime?: string

  @ApiPropertyOptional({ description: '指定接收用户 ID（逗号分隔，msgType=USER 时填）' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  userIds?: string
}
