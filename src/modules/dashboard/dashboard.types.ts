import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import type { UserEntity } from '../user/entities/user.entity'

/**
 * 首页概览的返回契约
 *
 * 设计要点：**没权限的块返回 null，而不是返回 0**。
 * 返回 0 会让前端无法区分「真的没有数据」和「你没权限看」，只能猜；返回 null 前端直接不渲染。
 */

/** 口径：all=全站（有权限）/ self=只看自己（降级） */
export type DashboardScope = 'all' | 'self'

export class DashboardProfile {
  @ApiProperty({ description: '用户 ID' })
  id: string

  @ApiProperty({ description: '登录账号' })
  username: string

  @ApiProperty({ description: '真实姓名（空则回退账号）' })
  realname: string

  @ApiPropertyOptional({ description: '头像地址', nullable: true })
  avatar: string | null

  @ApiProperty({ description: '所属部门名称（主部门在前）', type: [String] })
  deptNames: string[]

  @ApiProperty({ description: '角色名称', type: [String] })
  roleNames: string[]

  @ApiPropertyOptional({
    description: '最近一次成功登录（无记录时为 null）',
    nullable: true,
    type: 'object',
    properties: { time: { type: 'string' }, ip: { type: 'string' }, browser: { type: 'string' }, location: { type: 'string' } }
  })
  lastLogin: { time: string; ip: string; browser: string; location: string } | null
}

export class UserTotalBlock {
  @ApiProperty({ description: '口径：all 全站 / self 仅本人', enum: ['all', 'self'] })
  scope: DashboardScope

  @ApiProperty({ description: '可见范围内的用户总数（已滤掉软删）' })
  total: number

  @ApiProperty({ description: '启用（status=1）' })
  active: number

  @ApiProperty({ description: '冻结（status=2）' })
  frozen: number
}

export class TodayLoginBlock {
  @ApiProperty({ description: '口径', enum: ['all', 'self'] })
  scope: DashboardScope

  @ApiProperty({ description: '今日登录成功次数' })
  success: number

  @ApiProperty({ description: '今日登录失败次数' })
  fail: number
}

export class LoginTrendPoint {
  @ApiProperty({ description: '日期 YYYY-MM-DD', example: '2026-11-07' })
  date: string

  @ApiProperty({ description: '成功次数' })
  success: number

  @ApiProperty({ description: '失败次数' })
  fail: number
}

export class LoginTrendBlock {
  @ApiProperty({ description: '口径', enum: ['all', 'self'] })
  scope: DashboardScope

  @ApiProperty({ description: '近 N 天（含今天），缺数据的天补 0', type: [LoginTrendPoint] })
  points: LoginTrendPoint[]
}

export class OperLogRow {
  @ApiProperty({ description: '日志 ID' })
  id: string

  @ApiProperty({ description: '操作人' })
  operator: string

  @ApiProperty({ description: '操作内容（已截断，不含请求参数等敏感字段）' })
  content: string

  @ApiProperty({ description: '操作类型：1查询 2添加 3更新 4删除 5导入 6导出' })
  type: number

  @ApiProperty({ description: '结果：0 成功 / 1 失败' })
  status: number

  @ApiProperty({ description: '耗时（毫秒）' })
  costTime: number

  @ApiProperty({ description: 'IP' })
  ip: string

  @ApiProperty({ description: '发生时间' })
  time: string
}

export class RecentOpersBlock {
  @ApiProperty({ description: '口径', enum: ['all', 'self'] })
  scope: DashboardScope

  @ApiProperty({ description: '最近操作', type: [OperLogRow] })
  rows: OperLogRow[]
}

export class StorageBlock {
  @ApiProperty({ description: '已用字节（不含回收站）' })
  usedBytes: number

  @ApiProperty({ description: '配额字节' })
  quotaBytes: number

  @ApiProperty({ description: '在用文件数（不含文件夹与回收站）' })
  fileCount: number
}

export class TaskBlock {
  @ApiProperty({ description: '口径：all 含未指派任务 / self 仅指给我的', enum: ['all', 'self'] })
  scope: DashboardScope

  @ApiProperty({ description: '待处理' })
  pending: number

  @ApiProperty({ description: '进行中' })
  doing: number

  @ApiProperty({ description: '已完成' })
  done: number

  @ApiProperty({ description: '已取消' })
  cancelled: number
}

export class NoticeRow {
  @ApiProperty({ description: '公告 ID' })
  id: string

  @ApiProperty({ description: '标题' })
  title: string

  @ApiProperty({ description: '优先级：L低 M中 H高' })
  priority: string

  @ApiProperty({ description: '消息类型：1通知公告 2系统消息' })
  category: string

  @ApiProperty({ description: '发布时间' })
  sendTime: string | null
}

export class ServerStateBlock {
  @ApiProperty({ description: 'CPU 使用率（%）' })
  cpuUsage: number

  @ApiProperty({ description: '内存使用率（%）' })
  memoryUsage: number

  @ApiProperty({ description: '内存已用（MB）' })
  memoryUsedMb: number

  @ApiProperty({ description: '内存总量（MB）' })
  memoryTotalMb: number

  @ApiProperty({ description: '系统盘使用率（%）' })
  diskUsage: number

  @ApiProperty({ description: 'Node 版本' })
  nodeVersion: string

  @ApiProperty({ description: 'Node 进程已运行时长' })
  uptime: string
}

export class DashboardOverview {
  @ApiProperty({ description: '当前登录人', type: DashboardProfile })
  profile: DashboardProfile

  @ApiPropertyOptional({ description: '用户总数（无 system:user:list 时为 null）', type: UserTotalBlock, nullable: true })
  userTotal: UserTotalBlock | null

  @ApiPropertyOptional({ description: '今日登录（无日志权限时为「自己的」口径）', type: TodayLoginBlock, nullable: true })
  todayLogin: TodayLoginBlock | null

  @ApiPropertyOptional({ description: '在线人数（无 system:online:list 时为 null）', nullable: true })
  onlineCount: number | null

  @ApiPropertyOptional({ description: '角色总数（无 system:role:list 时为 null）', nullable: true })
  roleTotal: number | null

  @ApiPropertyOptional({ description: '登录趋势', type: LoginTrendBlock, nullable: true })
  loginTrend: LoginTrendBlock | null

  @ApiPropertyOptional({ description: '最近操作', type: RecentOpersBlock, nullable: true })
  recentOpers: RecentOpersBlock | null

  @ApiProperty({ description: '我的存储用量', type: StorageBlock })
  myStorage: StorageBlock

  @ApiProperty({ description: '任务统计', type: TaskBlock })
  myTasks: TaskBlock

  @ApiProperty({ description: '最新已发布公告', type: [NoticeRow] })
  notices: NoticeRow[]

  @ApiPropertyOptional({ description: '服务器状态（无 system:monitor:server 时为 null）', type: ServerStateBlock, nullable: true })
  serverState: ServerStateBlock | null
}

/** 请求上下文里的用户：就是 JwtStrategy.validate 返回的 UserEntity（只声明用到的那几个字段） */
export type DashboardActor = Pick<UserEntity, 'id' | 'username' | 'realname' | 'avatar' | 'departIds' | 'depts' | 'roles' | 'isPlatformAdmin'>
