import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min, Validate } from 'class-validator'
import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator'

/** 结束时间必须晚于开始时间 */
@ValidatorConstraint({ name: 'timeRange', async: false })
class TimeRangeConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const o = args.object as { startTime?: string; endTime?: string }
    if (!o.startTime || !o.endTime) return true // 单独缺失交给各自规则
    return new Date(o.endTime).getTime() > new Date(o.startTime).getTime()
  }
  defaultMessage(): string {
    return '结束时间必须晚于开始时间'
  }
}

export class CreateScheduleEventDto {
  @ApiProperty({ description: '所属日历 ID' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  calendarId: number

  @ApiProperty({ description: '日程标题', example: '产品评审会' })
  @IsString()
  @Length(1, 200, { message: '标题长度需在 1-200 之间' })
  title: string

  @ApiProperty({ description: '开始时间（ISO8601，含时区偏移）', example: '2026-11-10T09:00:00+08:00' })
  @IsString()
  @IsISO8601({}, { message: 'startTime 需为 ISO8601 时间' })
  startTime: string

  @ApiProperty({ description: '结束时间（ISO8601，含时区偏移）', example: '2026-11-10T10:00:00+08:00' })
  @IsString()
  @IsISO8601({}, { message: 'endTime 需为 ISO8601 时间' })
  @Validate(TimeRangeConstraint)
  endTime: string

  @ApiPropertyOptional({ description: '描述', example: '评审 V1.0 需求', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string

  @ApiPropertyOptional({ description: '标签：会议/待办/维护 等', example: '会议', maxLength: 50 })
  @IsOptional()
  @IsString()
  @Length(0, 50)
  category?: string

  @ApiPropertyOptional({ description: '提醒方式（当前仅 SOCKET=站内消息）', enum: ['SOCKET'], default: 'SOCKET' })
  @IsOptional()
  @IsIn(['SOCKET'], { message: '当前仅支持 SOCKET（站内消息）提醒' })
  remindType?: string

  @ApiPropertyOptional({ description: '提醒触发时间点（ISO8601；不传=不提醒；早于当前时间则由巡逻立即补发一次）', example: '2026-11-10T08:45:00+08:00' })
  @IsOptional()
  @IsString()
  @IsISO8601({}, { message: 'remindAt 需为 ISO8601 时间' })
  remindAt?: string
}

/** 更新日程：remindAt 传 null 表示取消提醒（Omit 后重声明，规避 string|null 联合类型反射问题） */
export class UpdateScheduleEventDto extends PartialType(OmitType(CreateScheduleEventDto, ['remindAt'] as const)) {
  @ApiPropertyOptional({ description: '提醒触发时间点（ISO8601），传 null 取消提醒', nullable: true })
  @IsOptional()
  remindAt?: string | null
}

export class QueryScheduleEventDto {
  @ApiPropertyOptional({ description: '区间查询开始（ISO8601 日期或时间）', example: '2026-11-01' })
  @IsOptional()
  @IsString()
  startDate?: string

  @ApiPropertyOptional({ description: '区间查询结束（ISO8601 日期或时间）', example: '2026-11-30' })
  @IsOptional()
  @IsString()
  endDate?: string

  @ApiPropertyOptional({ description: '按日历过滤' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  calendarId?: number

  @ApiPropertyOptional({ description: '最大返回条数（区间查询保护）', default: 500, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number
}
