import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, Length } from 'class-validator'

/** 创建定时任务（对齐 JeecgBoot sys_quartz_job 字段） */
export class CreateJobDto {
  @ApiProperty({ description: '任务类名（Node 侧为执行器标识，可选值见 GET /api/v1/jobs/handlers）', example: 'cleanLogJob' })
  @IsString()
  @Length(1, 255, { message: '任务类名长度必须在 1~255 之间' })
  jobClassName: string

  @ApiProperty({ description: 'cron 表达式（秒 分 时 日 月 周，6 位）', example: '0 0 3 * * *' })
  @IsString()
  @Length(1, 255, { message: 'cron 表达式长度必须在 1~255 之间' })
  cronExpression: string

  @ApiPropertyOptional({ description: '任务参数（原样传给执行器）', example: '30' })
  @IsOptional()
  @IsString()
  @Length(0, 255, { message: '参数最长 255 个字符' })
  parameter?: string

  @ApiPropertyOptional({ description: '任务描述', example: '每天 03:00 清理 30 天前日志' })
  @IsOptional()
  @IsString()
  @Length(0, 255, { message: '描述最长 255 个字符' })
  description?: string

  @ApiPropertyOptional({ description: '状态：0 正常（运行中）/ -1 停止，默认 -1（新建不自动开跑）', enum: [0, -1], example: -1 })
  @IsOptional()
  @IsIn([0, -1], { message: '状态只能是 0（正常）或 -1（停止）' })
  status?: number
}
