import { BadRequestException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { CronJob, CronTime } from 'cron'
import { Repository } from 'typeorm'

import { RedisService } from '../../../shared/redis/redis.service'
import { withRedisLock } from '../../../shared/redis/redis-lock.util'
import { SysQuartzJobEntity } from './entities/sys-quartz-job.entity'
import { JobHandlerRegistry, type JobTrigger } from './job.handlers'

/** 任务运行信息（内存态：进程重启后清空，nextRun 由当前 cron 实时算） */
export interface JobRunRecord {
  lastRun?: string
  lastResult?: string
  lastSuccess?: boolean
  lastDuration?: number
  nextRun?: string
}

export interface JobExecutionResult {
  success: boolean
  message: string
  duration: number
  trigger: JobTrigger
  runAt: string
}

const TIME_ZONE = 'Asia/Shanghai'

/**
 * 定时任务调度器（基于 cron 包动态注册）
 *
 * - 启动时把 status=0 且未删除的任务全部挂上调度
 * - 新增/修改/启停/删除后由 Service 调用 schedule / unschedule 增量同步
 * - 执行结果只保留在内存（sys_quartz_job 没有执行记录列，Quartz 自身的日志在 QRTZ_* 表里，
 *   本项目不引入那套表），需要持久化执行记录时接 sys_log.job_id
 */
@Injectable()
export class JobScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobScheduler.name)
  private readonly running = new Map<string, CronJob>()
  private readonly records = new Map<string, JobRunRecord>()

  constructor(
    @InjectRepository(SysQuartzJobEntity)
    private readonly jobRepository: Repository<SysQuartzJobEntity>,
    private readonly registry: JobHandlerRegistry,
    private readonly redis: RedisService
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.reloadAll()
    } catch (error) {
      // 调度失败不能拖垮应用启动
      this.logger.error(`定时任务初始化失败：${(error as Error).message}`)
    }
  }

  onModuleDestroy(): void {
    for (const job of this.running.values()) {
      // stop() 返回 Promise，这里处于同步销毁钩子中，标记忽略即可（进程正在退出）
      void job.stop()
    }
    this.running.clear()
  }

  /** 全量重载：把启用中的任务重新挂上调度 */
  async reloadAll(): Promise<void> {
    const jobs = await this.jobRepository.find({ where: { delFlag: 0, status: 0 } })
    const alive = new Set(jobs.map(job => job.id))
    // Map 迭代时删除当前 key 是安全的（已被删除的项不会再被遍历）
    for (const id of this.running.keys()) {
      if (!alive.has(id)) {
        this.unschedule(id)
      }
    }
    for (const job of jobs) {
      try {
        this.schedule(job)
      } catch (error) {
        this.logger.error(`任务「${job.jobClassName ?? job.id}」挂载失败：${(error as Error).message}`)
      }
    }
    this.logger.log(`定时任务已加载 ${jobs.length} 个`)
  }

  /** 挂载/更新单个任务调度（先停旧的再挂新的） */
  schedule(job: SysQuartzJobEntity): void {
    this.unschedule(job.id)
    if (job.status !== 0 || job.delFlag === 1 || !job.cronExpression) {
      return
    }
    JobScheduler.assertCron(job.cronExpression)
    const cronJob = CronJob.from({
      cronTime: job.cronExpression,
      onTick: () => {
        void this.execute(job, 'cron')
      },
      start: true,
      timeZone: TIME_ZONE
    })
    this.running.set(job.id, cronJob)
  }

  /** 停止并移除任务调度 */
  unschedule(id: string): void {
    const cronJob = this.running.get(id)
    if (cronJob) {
      // stop() 返回 Promise，调用方是同步的 CRUD 流程，标记忽略即可
      void cronJob.stop()
      this.running.delete(id)
    }
  }

  /** 立即执行一次（不受启停状态限制，手动触发场景） */
  async runOnce(job: SysQuartzJobEntity): Promise<JobExecutionResult> {
    return this.execute(job, 'manual')
  }

  /** 任务运行信息（列表展示用） */
  recordOf(id: string): JobRunRecord {
    const record = this.records.get(id) ?? {}
    const next = this.running.get(id)?.nextDate()
    return { ...record, nextRun: next ? next.toJSDate().toISOString() : undefined }
  }

  /** 校验 cron 表达式，非法直接抛 400 */
  static assertCron(expression: string): void {
    try {
      new CronTime(expression)
    } catch {
      throw new BadRequestException(`cron 表达式「${expression}」不合法，请使用 6 位格式（秒 分 时 日 月 周）`)
    }
  }

  private async execute(job: SysQuartzJobEntity, trigger: JobTrigger): Promise<JobExecutionResult> {
    // cron 触发走分布式锁：多实例部署时同一周期只有一个实例真正执行；
    // 手动触发（runOnce）不走锁——管理员点「立即执行」必须次次有结果。
    // 锁 TTL 600s：任务没有超时控制，取一个远大于常规执行时长的值，宁可极端场景漏发不可重复跑。
    if (trigger === 'cron') {
      await withRedisLock(this.redis, `job:lock:${job.id}`, 600, async () => {
        await this.runAndRecord(job, trigger)
      })
      // 被锁跳过时无执行记录可写，返回一个中性的「未持锁」结果
      return { success: true, message: '已在其他实例执行（分布式锁跳过）', duration: 0, trigger, runAt: new Date().toISOString() }
    }
    return this.runAndRecord(job, trigger)
  }

  private async runAndRecord(job: SysQuartzJobEntity, trigger: JobTrigger): Promise<JobExecutionResult> {
    const startedAt = Date.now()
    const runAt = new Date().toISOString()
    let success = true
    let message: string
    try {
      const handler = this.registry.get(job.jobClassName ?? '')
      if (!handler) {
        throw new Error(`执行器「${job.jobClassName ?? ''}」未注册`)
      }
      message = (await handler({ job, parameter: job.parameter ?? '', trigger })) || '执行成功'
    } catch (error) {
      success = false
      message = (error as Error).message
      this.logger.warn(`任务「${job.jobClassName ?? job.id}」执行失败：${message}`)
    }
    const duration = Date.now() - startedAt
    this.records.set(job.id, { lastRun: runAt, lastResult: message, lastSuccess: success, lastDuration: duration })
    // 执行结束后刷新一次 nextRun（cron 触发后下一次时间会变）
    const next = this.running.get(job.id)?.nextDate()
    if (next) {
      this.records.set(job.id, { ...this.records.get(job.id), nextRun: next.toJSDate().toISOString() })
    }
    return { success, message, duration, trigger, runAt }
  }
}
