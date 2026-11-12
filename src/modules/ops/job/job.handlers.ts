import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'

import type { SysQuartzJobEntity } from './entities/sys-quartz-job.entity'

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

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
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
        const result: unknown = await this.dataSource.query('DELETE FROM sys_log WHERE create_time < DATE_SUB(NOW(), INTERVAL ? DAY)', [Math.floor(days)])
        const affected = (result as { affectedRows?: number })?.affectedRows ?? 0
        this.logger.log(`[cleanLogJob] 已清理 ${days} 天前日志 ${affected} 条`)
        return `已清理 ${days} 天前日志 ${affected} 条`
      },
      '清理日志：删除 N 天前的登录/操作日志，参数为保留天数（默认 30）'
    )
  }
}
