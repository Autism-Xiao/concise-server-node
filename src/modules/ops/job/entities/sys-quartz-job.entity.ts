import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, PrimaryColumn } from 'typeorm'

/**
 * 定时任务实体
 *
 * 与原表的差异在语义层：原表的 job_class_name 是 Java Quartz Job 实现类全限定名，
 * Node 侧没有 Java 类，这里当作「执行器标识」，由 JobHandlerRegistry 注册的可执行函数消费。
 */
@Entity('sys_quartz_job')
export class SysQuartzJobEntity {
  @ApiProperty({ description: '主键 ID（32 位字符串）' })
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '主键id' })
  id: string

  @ApiPropertyOptional({ description: '任务类名（Node 侧为执行器标识，如 cleanLogJob）', example: 'cleanLogJob' })
  @Column({ name: 'job_class_name', type: 'varchar', length: 255, nullable: true, comment: '任务类名' })
  jobClassName?: string

  @ApiPropertyOptional({ description: 'cron 表达式（秒 分 时 日 月 周）', example: '0 0 3 * * *' })
  @Column({ name: 'cron_expression', type: 'varchar', length: 255, nullable: true, comment: 'cron表达式' })
  cronExpression?: string

  @ApiPropertyOptional({ description: '任务参数（原样传给执行器）', example: '30' })
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '参数' })
  parameter?: string

  @ApiPropertyOptional({ description: '任务描述', example: '每天 03:00 清理 30 天前日志' })
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '描述' })
  description?: string

  @ApiProperty({ description: '状态：0 正常（运行中）/ -1 停止', example: 0, enum: [0, -1] })
  @Column({ type: 'int', nullable: true, default: 0, comment: '状态（0正常 -1停止）' })
  status: number

  @ApiProperty({ description: '删除标记：0 正常 / 1 已删除（int 型 del_flag）', example: 0 })
  @Column({ name: 'del_flag', type: 'int', nullable: true, default: 0, comment: '删除状态（0正常 1已删除）' })
  delFlag: number

  @ApiPropertyOptional({ description: '创建人' })
  @Column({ name: 'create_by', type: 'varchar', length: 32, nullable: true, comment: '创建人' })
  createBy?: string

  @ApiPropertyOptional({ description: '创建时间' })
  @Column({ name: 'create_time', type: 'datetime', nullable: true, comment: '创建时间' })
  createTime?: Date

  @ApiPropertyOptional({ description: '修改人' })
  @Column({ name: 'update_by', type: 'varchar', length: 32, nullable: true, comment: '修改人' })
  updateBy?: string

  @ApiPropertyOptional({ description: '修改时间' })
  @Column({ name: 'update_time', type: 'datetime', nullable: true, comment: '修改时间' })
  updateTime?: Date
}
