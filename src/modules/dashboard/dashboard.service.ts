import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'

import { PermissionCacheService } from '../../shared/permission-cache/permission-cache.service'
import { hasSuperRole } from '../../utils/super-role.util'
import { MonitorService } from '../ops/monitor/monitor.service'
import { OnlineService } from '../ops/online/online.service'
import { fileQuotaBytes } from '../tools/file/file.service'
import { UserService } from '../user/user.service'
import type {
  DashboardActor,
  DashboardOverview,
  DashboardScope,
  LoginTrendBlock,
  LoginTrendPoint,
  NoticeRow,
  OperLogRow,
  RecentOpersBlock,
  ServerStateBlock,
  StorageBlock,
  TaskBlock,
  TodayLoginBlock,
  UserTotalBlock
} from './dashboard.types'

/** 登录趋势展示天数（含今天）。库里日志只有几天历史，画 30 天空图没意义 */
const TREND_DAYS = 7

/** 最近操作/公告最多返回条数 */
const RECENT_LIMIT = 5

/** 单条操作日志内容的最大展示长度（详情页能看全文，首页只要一眼能读懂） */
const OPER_CONTENT_MAX = 80

/** 按钮权限标识（与 @Perms 装饰器、角色授权页里勾的完全一致） */
const PERM = {
  userList: 'system:user:list',
  loginLog: 'system:log:login',
  operLog: 'system:log:oper',
  onlineList: 'system:online:list',
  roleList: 'system:role:list',
  monitorServer: 'system:monitor:server',
  taskList: 'system:task:list'
} as const

/** 权限判定结果：'all' 表示超管（全放行），否则是命中的 perm 集合 */
type OwnedPerms = 'all' | Set<string>

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** 本地日期键 YYYY-MM-DD（与 MySQL DATE_FORMAT 的本地时区口径一致） */
function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 今天零点（本地时区） */
function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/** 统一把 mysql2 返回的 DATETIME / string 转成 ISO 字符串 */
function toIso(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/**
 * 首页概览聚合
 *
 * 为什么做成一个接口而不是前端调 8 个：
 *  - 首页要的数据是「多表 count / group by」，不是分页列表，拿列表接口当统计用只能靠 pageSize=1 读 total，很别扭；
 *  - 权限裁剪必须发生在服务端（前端 localStorage 里的权限可被手工篡改），
 *    一个接口意味着「裁剪逻辑只有一处」，代码审查只看这一张 perm 表；
 *  - 首屏 1 个请求，不会出现「8 个请求里 5 个 403」的噪声。
 *
 * 裁剪规则（详见 docs）：
 *  1) 块级：没权限 → 整块返回 null（不是 0）
 *  2) 降级：登录趋势 / 最近操作 / 今日登录没有全站权限时，自动降级为「只看自己」，
 *     并在 scope 里告诉前端当前口径，避免"为什么我和同事看到的数字不一样"
 *  3) 行级：userTotal 走 UserService.countScoped（复用 sys_role.data_scope 部门范围）
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly userService: UserService,
    private readonly onlineService: OnlineService,
    private readonly monitorService: MonitorService,
    private readonly permissionCache: PermissionCacheService
  ) {}

  async overview(actor: DashboardActor): Promise<DashboardOverview> {
    const owned = await this.ownedPerms(actor)
    const can = (perm: string): boolean => owned === 'all' || owned.has(perm)

    // 三处「可能降级」的判定先算出来，避免下面每块各写一遍 can()
    const loginScope: DashboardScope = can(PERM.loginLog) ? 'all' : 'self'
    const operScope: DashboardScope = can(PERM.operLog) ? 'all' : 'self'

    // 全部并行：getServerInfo 内部有 200ms CPU 采样，串行会把它叠加到首屏
    const [profile, userTotal, todayLogin, onlineCount, roleTotal, loginTrend, recentOpers, myStorage, myTasks, notices, serverState] = await Promise.all([
      this.buildProfile(actor),
      can(PERM.userList) ? this.userTotal(actor) : Promise.resolve(null),
      this.todayLogin(actor, loginScope),
      can(PERM.onlineList) ? this.onlineCount() : Promise.resolve(null),
      can(PERM.roleList) ? this.roleTotal() : Promise.resolve(null),
      this.loginTrend(actor, loginScope),
      this.recentOpers(actor, operScope),
      this.myStorage(actor),
      this.myTasks(actor, can(PERM.taskList) ? 'all' : 'self'),
      this.notices(),
      can(PERM.monitorServer) ? this.serverState() : Promise.resolve(null)
    ])

    return {
      profile,
      userTotal,
      todayLogin,
      onlineCount,
      roleTotal,
      loginTrend,
      recentOpers,
      myStorage,
      myTasks,
      notices,
      serverState
    }
  }

  /* ------------------------------ 权限 ------------------------------ */

  /** 超管直接全放行；其余走按角色缓存的权限集合（与 PermsGuard 同源，改完授权立刻生效） */
  private async ownedPerms(actor: DashboardActor): Promise<OwnedPerms> {
    if (hasSuperRole(actor.roles)) return 'all'
    const roleIds = (actor.roles ?? []).map(role => role.id)
    if (!roleIds.length) return new Set()
    return this.permissionCache.getRolesPerms(roleIds)
  }

  /* ------------------------------ 各块 ------------------------------ */

  private async buildProfile(actor: DashboardActor): Promise<DashboardOverview['profile']> {
    // 登录日志里 operate_user_name 记录的是「尝试登录的账号」，按账号取最近一条成功记录
    const rows = await this.dataSource.query<Array<{ create_time: Date; ip: string; browser: string | null; location: string | null }>>(
      `SELECT create_time, ip, browser, location FROM sys_log
       WHERE log_type = 0 AND status = 0 AND operate_user_name = ?
       ORDER BY create_time DESC LIMIT 1`,
      [actor.username]
    )
    const last = rows[0]
    return {
      id: actor.id,
      username: actor.username,
      realname: actor.realname?.trim() || actor.username,
      avatar: actor.avatar ?? null,
      deptNames: (actor.depts ?? []).map(dept => dept.departName ?? '').filter(Boolean),
      roleNames: (actor.roles ?? []).map(role => role.roleName ?? role.roleCode ?? '').filter(Boolean),
      lastLogin: last ? { time: toIso(last.create_time) ?? '', ip: last.ip ?? '', browser: last.browser ?? '', location: last.location ?? '' } : null
    }
  }

  private async userTotal(actor: DashboardActor): Promise<UserTotalBlock> {
    // 复用 UserService 的 scopedQuery：软删过滤 + sys_role.data_scope 部门范围都在那边，
    // 保证首页的「用户总数」与用户列表的 total 永远同口径
    const counts = await this.userService.countScoped(actor)
    return { scope: 'all', ...counts }
  }

  private async todayLogin(actor: DashboardActor, scope: DashboardScope): Promise<TodayLoginBlock> {
    const params: unknown[] = [startOfToday()]
    let selfFilter = ''
    if (scope === 'self') {
      selfFilter = ' AND operate_user_name = ?'
      params.push(actor.username)
    }
    const rows = await this.dataSource.query<Array<{ ok: string | number; fail: string | number }>>(
      `SELECT COALESCE(SUM(status = 0), 0) AS ok, COALESCE(SUM(status = 1), 0) AS fail
       FROM sys_log WHERE log_type = 0 AND create_time >= ?${selfFilter}`,
      params
    )
    return { scope, success: Number(rows[0]?.ok ?? 0), fail: Number(rows[0]?.fail ?? 0) }
  }

  private async onlineCount(): Promise<number> {
    return this.onlineService.count()
  }

  private async roleTotal(): Promise<number> {
    const rows = await this.dataSource.query<Array<{ total: string | number }>>('SELECT COUNT(1) AS total FROM sys_role')
    return Number(rows[0]?.total ?? 0)
  }

  private async loginTrend(actor: DashboardActor, scope: DashboardScope): Promise<LoginTrendBlock> {
    const from = new Date(startOfToday())
    from.setDate(from.getDate() - (TREND_DAYS - 1))

    const params: unknown[] = [from]
    let selfFilter = ''
    if (scope === 'self') {
      selfFilter = ' AND operate_user_name = ?'
      params.push(actor.username)
    }
    const rows = await this.dataSource.query<Array<{ d: string; ok: string | number; fail: string | number }>>(
      `SELECT DATE_FORMAT(create_time, '%Y-%m-%d') AS d,
              COALESCE(SUM(status = 0), 0) AS ok,
              COALESCE(SUM(status = 1), 0) AS fail
       FROM sys_log WHERE log_type = 0 AND create_time >= ?${selfFilter}
       GROUP BY d ORDER BY d`,
      params
    )

    // 按日期补零：没有日志的那天也要画出来，否则折线会把两个不相邻的日期连成一条"假趋势"
    const byDate = new Map(rows.map(row => [String(row.d), { success: Number(row.ok), fail: Number(row.fail) }]))
    const points: LoginTrendPoint[] = []
    for (let i = 0; i < TREND_DAYS; i++) {
      const day = new Date(from)
      day.setDate(from.getDate() + i)
      const key = dateKey(day)
      points.push({ date: key, ...(byDate.get(key) ?? { success: 0, fail: 0 }) })
    }
    return { scope, points }
  }

  private async recentOpers(actor: DashboardActor, scope: DashboardScope): Promise<RecentOpersBlock> {
    const params: unknown[] = []
    let selfFilter = ''
    if (scope === 'self') {
      selfFilter = ' AND operate_user_id = ?'
      params.push(actor.id)
    }
    const rows = await this.dataSource.query<
      Array<{
        id: string
        operate_user_name: string
        log_content: string
        operate_type: number | null
        status: number
        cost_time: string | number | null
        ip: string
        create_time: Date
      }>
    >(
      `SELECT id, operate_user_name, log_content, operate_type, status, cost_time, ip, create_time
       FROM sys_log WHERE log_type = 1${selfFilter}
       ORDER BY create_time DESC LIMIT ${RECENT_LIMIT}`,
      params
    )

    const list: OperLogRow[] = rows.map(row => {
      const content = row.log_content ?? ''
      return {
        id: row.id,
        operator: row.operate_user_name ?? '',
        content: content.length > OPER_CONTENT_MAX ? `${content.slice(0, OPER_CONTENT_MAX)}…` : content,
        type: Number(row.operate_type ?? 0),
        status: Number(row.status ?? 0),
        costTime: Number(row.cost_time ?? 0),
        ip: row.ip ?? '',
        time: toIso(row.create_time) ?? ''
      }
    })
    return { scope, rows: list }
  }

  private async myStorage(actor: DashboardActor): Promise<StorageBlock> {
    const rows = await this.dataSource.query<Array<{ cnt: string | number; bytes: string | number | null }>>(
      `SELECT COUNT(1) AS cnt, COALESCE(SUM(size), 0) AS bytes
       FROM sys_file WHERE owner_id = ? AND is_folder = 0 AND is_deleted = 0`,
      [actor.id]
    )
    return {
      usedBytes: Number(rows[0]?.bytes ?? 0),
      quotaBytes: fileQuotaBytes(),
      fileCount: Number(rows[0]?.cnt ?? 0)
    }
  }

  private async myTasks(actor: DashboardActor, scope: DashboardScope): Promise<TaskBlock> {
    // task.assignee_id 已迁移为 varchar(32)，与 sys_user.id 同型，可直接匹配；'0' 表示未指派
    const params: unknown[] = []
    let where: string
    if (scope === 'all') {
      where = "(assignee_id = ? OR assignee_id = '0')"
      params.push(actor.id)
    } else {
      where = 'assignee_id = ?'
      params.push(actor.id)
    }

    const rows = await this.dataSource.query<Array<{ status: number; n: string | number }>>(
      `SELECT status, COUNT(1) AS n FROM task WHERE ${where} GROUP BY status`,
      params
    )
    const counts = { pending: 0, doing: 0, done: 0, cancelled: 0 }
    const keyByStatus: Record<number, keyof typeof counts> = { 0: 'pending', 1: 'doing', 2: 'done', 3: 'cancelled' }
    for (const row of rows) {
      const key = keyByStatus[Number(row.status)]
      if (key) counts[key] = Number(row.n)
    }
    return { scope, ...counts }
  }

  private async notices(): Promise<NoticeRow[]> {
    // 注意：sys_announcement 的标题列在建表时拼成了 titile（JeecgBoot 历史拼写），不是 title
    const rows = await this.dataSource.query<
      Array<{ id: string; titile: string; priority: string | null; msg_category: string | null; send_time: Date | null }>
    >(
      `SELECT id, titile, priority, msg_category, send_time FROM sys_announcement
       WHERE send_status = '1' ORDER BY send_time DESC LIMIT ${RECENT_LIMIT}`
    )
    return rows.map(row => ({
      id: row.id,
      title: row.titile ?? '',
      priority: row.priority ?? 'M',
      category: row.msg_category ?? '1',
      sendTime: toIso(row.send_time)
    }))
  }

  private async serverState(): Promise<ServerStateBlock> {
    const info = await this.monitorService.getServerInfo()
    const systemDisk = info.disks[0]
    return {
      cpuUsage: info.cpu.usage,
      memoryUsage: info.memory.usage,
      memoryUsedMb: info.memory.used,
      memoryTotalMb: info.memory.total,
      diskUsage: systemDisk?.usage ?? 0,
      nodeVersion: info.node.version,
      uptime: info.node.uptime
    }
  }
}
