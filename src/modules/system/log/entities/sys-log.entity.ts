import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, PrimaryColumn } from 'typeorm'

/**
 * 日志表（对齐 JeecgBoot sys_log 单表设计）
 * - 登录日志 log_type=0、操作日志 log_type=1 共用一张表
 * - status 为 JeecgBoot 语义：0 正常（成功）/ 1 异常（失败）——与旧表 1成功0失败 相反
 * - 主键 32 位字符串；create_time 为事件时间
 * - browser/os/location/params/error_msg 为本项目扩展列（JeecgBoot 原表没有）
 */
@Entity('sys_log')
export class SysLogEntity {
  @ApiProperty({ description: '主键 ID（32 位字符串）' })
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '主键id' })
  id: string

  @ApiPropertyOptional({ description: '定时任务 ID（对齐 JeecgBoot，本项目暂不用）', nullable: true })
  @Column({ type: 'varchar', length: 32, nullable: true, comment: '定时任务id' })
  jobId?: string

  @ApiProperty({ description: '日志内容', example: '登录成功', type: String })
  @Column({ length: 1000, comment: '日志内容' })
  logContent: string

  @ApiProperty({ description: '日志类型：0 登录日志 / 1 操作日志', example: 0, enum: [0, 1] })
  @Column({ type: 'int', comment: '日志类型（0登录日志，1操作日志）' })
  logType: number

  @ApiPropertyOptional({ description: '操作类型（JeecgBoot）：1 查询 / 2 添加 / 3 更新 / 4 删除 / 5 导入 / 6 导出', example: 2, nullable: true })
  @Column({ type: 'int', nullable: true, comment: '操作类型（1查询 2添加 3更新 4删除 5导入 6导出）' })
  operateType?: number

  @ApiPropertyOptional({ description: '操作人用户 ID（sys_user.id）', nullable: true })
  @Column({ type: 'varchar', length: 32, nullable: true, comment: '操作人员id' })
  operateUserId?: string

  @ApiProperty({ description: '操作人用户名（登录日志为尝试的账号）', example: 'admin' })
  @Column({ length: 100, comment: '操作人员名称' })
  operateUserName: string

  @ApiProperty({ description: 'IP', example: '127.0.0.1' })
  @Column({ length: 100, comment: 'IP' })
  ip: string

  @ApiProperty({ description: '结果（JeecgBoot 语义）：0 正常（成功）/ 1 异常（失败）', example: 0, enum: [0, 1] })
  @Column({ type: 'int', comment: '操作状态（0正常，1异常）' })
  status: number

  @ApiPropertyOptional({ description: '耗时（毫秒）', example: 35, nullable: true })
  @Column({ type: 'bigint', nullable: true, comment: '耗时（毫秒）' })
  costTime?: number

  @ApiPropertyOptional({ description: '浏览器（UA 解析，登录日志扩展列）', example: 'Chrome 156', nullable: true })
  @Column({ length: 64, nullable: true, comment: '浏览器（UA解析，扩展列）' })
  browser?: string

  @ApiPropertyOptional({ description: '操作系统（UA 解析，登录日志扩展列）', example: 'Windows 10', nullable: true })
  @Column({ length: 64, nullable: true, comment: '操作系统（UA解析，扩展列）' })
  os?: string

  @ApiPropertyOptional({ description: 'IP 归属地（ip2region，登录日志扩展列）', example: '本机', nullable: true })
  @Column({ length: 128, nullable: true, comment: 'IP归属地（ip2region，扩展列）' })
  location?: string

  @ApiPropertyOptional({ description: '请求参数（JSON，操作日志扩展列）', nullable: true })
  @Column({ type: 'text', nullable: true, comment: '请求参数（body+query JSON，扩展列）' })
  params?: string

  @ApiPropertyOptional({ description: '错误信息（失败时，操作日志扩展列）', nullable: true })
  @Column({ length: 500, nullable: true, comment: '错误信息（扩展列）' })
  errorMsg?: string

  @ApiPropertyOptional({ description: '创建人（=操作人）', nullable: true })
  @Column({ length: 32, nullable: true, comment: '创建人' })
  createBy?: string

  @ApiProperty({ description: '事件时间' })
  @Column({ type: 'datetime', comment: '创建时间' })
  createTime: Date
}
