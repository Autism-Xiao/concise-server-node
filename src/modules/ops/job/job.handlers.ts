import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'

import type { SysQuartzJobEntity } from './entities/sys-quartz-job.entity'
import { DbBackupService } from '../../../shared/backup/db-backup.service'
import { MessageService } from '../../message/message.service'
import { TenantContext } from '../../../shared/tenant/tenant.context'
import { tenantWriteSql } from '../../../shared/tenant/tenant-scope.util'

/** 触发来源：cron 定时触发 / manual 页面「执行一次」 */
export type JobTrigger = 'cron' | 'manual'

export interface JobHandlerContext {
  /** 任务记录本身（含 id / 参数 / 描述） */
  job: SysQuartzJobEntity
  /** sys_quartz_job.parameter，未配置时为空串 */
  parameter: string
  trigger: JobTrigger
}

/** 执行器：返回字符串作为执行结果摘要（会展示在列表「上次结果」列） */
export type JobHandler = (context: JobHandlerContext) => Promise<string> | string

export interface JobHandlerMeta {
  className: string
  description: string
}

/**
 * 定时任务执行器注册表
 *
 * 原表里 job_class_name 是 Java Quartz Job 实现类的全限定名，靠反射实例化；
 * Node 没有反射式类加载，改为「注册表 + 可执行函数」：
 * 调度器按 job_class_name 到本注册表取函数执行，取不到视为任务配置错误（执行失败并记录原因）。
 *
 * 扩展方式：在业务模块里注入本类，调用 register('myJob', async ({ parameter }) => {...}, '说明')。
 */
@Injectable()
export class JobHandlerRegistry {
  private readonly logger = new Logger(JobHandlerRegistry.name)
  private readonly handlers = new Map<string, JobHandler>()
  private readonly descriptions = new Map<string, string>()

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    // 定时备份：导出 + 导入校验 + 保留策略，实现见 shared/backup
    private readonly dbBackup: DbBackupService,
    // 租户到期提醒：站内信程序化投递（notify 不走 @Perms）
    private readonly message: MessageService
  ) {
    this.registerBuiltins()
  }

  /** 注册执行器（同名重复注册以最后一次为准） */
  register(className: string, handler: JobHandler, description: string): void {
    this.handlers.set(className, handler)
    this.descriptions.set(className, description)
  }

  /** 取执行器，未注册返回 undefined */
  get(className: string): JobHandler | undefined {
    return this.handlers.get(className)
  }

  /** 是否已注册 */
  has(className: string): boolean {
    return this.handlers.has(className)
  }

  /** 可选执行器清单（前端表单下拉用） */
  list(): JobHandlerMeta[] {
    return [...this.descriptions.entries()].map(([className, description]) => ({ className, description }))
  }

  /** 项目内置执行器 */
  private registerBuiltins(): void {
    this.register(
      'heartbeatJob',
      ({ trigger }) => {
        this.logger.log(`[heartbeatJob] 心跳正常（${trigger === 'manual' ? '手动触发' : '定时触发'}）`)
        return '心跳正常'
      },
      '心跳任务：写一条心跳日志，用于验证调度是否生效'
    )

    this.register(
      'cleanLogJob',
      async ({ parameter }) => {
        const days = Number(parameter || 30)
        if (!Number.isFinite(days) || days <= 0) {
          throw new Error(`参数「${parameter}」不是合法天数`)
        }
        // 外层 JobScheduler 已按 job.tenant_id 注入 TenantContext，但 ALS 管不到原生 SQL：
        // 这里必须自己把租户条件拼进去，否则「租户级日志清理任务」会把别的租户日志一起删光。
        // 平台级任务（tenant_id=0 → 上下文 null）保持全库清理的原有语义。
        const scope = tenantWriteSql(TenantContext.filterTenantId())
        const result: unknown = await this.dataSource.query(`DELETE FROM sys_log WHERE create_time < DATE_SUB(NOW(), INTERVAL ? DAY)${scope.clause}`, [
          Math.floor(days),
          ...scope.params
        ])
        const affected = (result as { affectedRows?: number })?.affectedRows ?? 0
        this.logger.log(`[cleanLogJob] 已清理 ${days} 天前日志 ${affected} 条`)
        return `已清理 ${days} 天前日志 ${affected} 条`
      },
      '清理日志：删除 N 天前的登录/操作日志，参数为保留天数（默认 30）'
    )

    this.register(
      'backupDbJob',
      async () => {
        const result = await this.dbBackup.backupNow()
        const verifyText = result.verified ? `校验通过（${result.tables} 张表）` : '未校验'
        return `备份完成 ${result.file}（${result.sizeMb} MB，${verifyText}，清理旧备份 ${result.pruned} 份）`
      },
      '数据库备份：导出全库 → 临时库导入校验 → 按保留策略清理（默认留 7 份，可在参数配置里改）'
    )

    this.register(
      'tenantExpireJob',
      async ({ parameter }) => {
        // 提前提醒天数：参数缺省 7 天；临期（含今天到期）给开通人发提醒，已过期给平台管理员发汇总
        const days = Number(parameter || 7)
        if (!Number.isFinite(days) || days <= 0) {
          throw new Error(`参数「${parameter}」不是合法天数`)
        }
        const todayKey = new Date().toISOString().slice(0, 10)
        const expiring = await this.dataSource.query<{ id: number; name: string; code: string; expireAt: string; ownerUserId: string | null }[]>(
          `SELECT id, name, code, DATE_FORMAT(expire_at, '%Y-%m-%d') AS expireAt, owner_user_id AS ownerUserId
             FROM sys_tenant
            WHERE del_flag = 0 AND status = 0
              AND owner_user_id IS NOT NULL
              AND expire_at IS NOT NULL AND expire_at >= CURDATE()
              AND expire_at <= DATE_ADD(CURDATE(), INTERVAL ? DAY)`,
          [Math.floor(days)]
        )
        let notified = 0
        for (const tenant of expiring) {
          if (!tenant.ownerUserId) continue
          const daysLeft = Math.round((Date.parse(tenant.expireAt) - Date.parse(todayKey)) / 86_400_000)
          // 当天去重：同接收人同日已收过「租户到期提醒」就不再发（手动重跑/多实例不重复轰炸）
          const dup = await this.dataSource.query<{ one: number }[]>(
            `SELECT 1 AS one FROM sys_message m
               JOIN sys_message_user mu ON mu.message_id = m.id
              WHERE m.title = '租户到期提醒' AND m.created_at >= CURDATE() AND mu.user_id = ?
              LIMIT 1`,
            [tenant.ownerUserId]
          )
          if (dup.length) continue
          const content =
            daysLeft === 0
              ? `租户「${tenant.name}」（${tenant.code}）今日到期。到期后用户将无法进入该租户，请及时续期。`
              : `租户「${tenant.name}」（${tenant.code}）将于 ${tenant.expireAt} 到期（剩余 ${daysLeft} 天）。到期后用户将无法进入该租户，请及时续期。`
          notified += await this.message.notify('租户到期提醒', content, [tenant.ownerUserId])
        }

        // 已到期但仍是「正常」状态的租户：读取时判定已拦截用户进入，这里只给平台管理员发汇总
        const expiredRows = await this.dataSource.query<{ cnt: number }[]>(
          `SELECT COUNT(*) AS cnt FROM sys_tenant WHERE del_flag = 0 AND status = 0 AND expire_at IS NOT NULL AND expire_at < CURDATE()`
        )
        const expiredCount = Number(expiredRows[0]?.cnt ?? 0)
        let platformNotified = 0
        if (expiredCount > 0) {
          const dup = await this.dataSource.query<{ one: number }[]>(
            `SELECT 1 AS one FROM sys_message WHERE title = '租户已到期汇总' AND created_at >= CURDATE() LIMIT 1`
          )
          if (!dup.length) {
            // sys_user.status 语义与租户表相反：1=正常、2=冻结（USER_STATUS.NORMAL = 1）
            const admins = await this.dataSource.query<{ id: string }[]>(`SELECT id FROM sys_user WHERE is_platform_admin = 1 AND del_flag = 0 AND status = 1`)
            platformNotified = await this.message.notify(
              '租户已到期汇总',
              `当前有 ${expiredCount} 个租户已到期（到期后用户无法进入，数据保留）。请在租户管理里续期或停用。`,
              admins.map(row => row.id)
            )
          }
        }
        this.logger.log(
          `[tenantExpireJob] 临期租户 ${expiring.length} 个，提醒开通人 ${notified} 人；已过期 ${expiredCount} 个，平台汇总 ${platformNotified} 人`
        )
        return `临期 ${expiring.length} 个（提醒 ${notified} 人），已过期 ${expiredCount} 个（平台汇总 ${platformNotified} 人）`
      },
      '租户到期提醒：临期租户给开通人发站内信、已过期给平台管理员发汇总；参数为提前提醒天数（默认 7）'
    )
  }
}
