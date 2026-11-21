import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { CronJob } from 'cron'

import { FileService, recycleRetentionDays, tempRetentionHours } from './file.service'
import { TenantContext } from '../../../shared/tenant/tenant.context'

/** 每天 03:30 扫一次（避开整点，减少和其它定时任务撞在同一分钟） */
const SWEEP_CRON = '30 3 * * *'

/**
 * 文件存储清理任务
 *
 * 两件事，都是「没人做就会慢慢积成病」的类型：
 * 1. **超期回收站**：配额只算未删除文件，回收站不占账面但占磁盘，没有保留期磁盘只增不减；
 * 2. **残留临时文件**：上传中断（客户端断开、进程被强杀）时 multer 的临时文件没人收尸。
 *
 * 启动时也扫一轮：本地开发经常是「关掉终端就重启」，只等每天 03:30 可能永远等不到。
 */
@Injectable()
export class FileCleaner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FileCleaner.name)
  private readonly cronJob = new CronJob(SWEEP_CRON, () => void this.sweep())

  constructor(private readonly fileService: FileService) {}

  onModuleInit(): void {
    this.cronJob.start()
    // 不 await：清理是后台动作，不该拖慢应用启动（数据库慢时尤其明显）
    void this.sweep()
    this.logger.log(`文件清理任务已就绪：回收站保留 ${recycleRetentionDays()} 天，临时文件保留 ${tempRetentionHours()} 小时`)
  }

  onModuleDestroy(): void {
    this.cronJob.stop()
  }

  /** 扫一轮；两段互相独立，任何一段失败都不影响另一段，也不向外抛 */
  async sweep(): Promise<void> {
    // 显式声明平台视角：cron 线程 ALS 为空时 filterTenantId() 恰好返回 null（全租户），
    // 但这是「没上下文」而不是「平台上下文」。如果将来有人从请求链里直接调用 sweep，
    // 上层的租户上下文会泄漏进来，回收站就只扫一个租户（不越权但会漏清理）。
    // 固定成 null 让这个维护任务的行为与调用方无关。
    return TenantContext.withTenant(null, () => this.sweepInternal())
  }

  private async sweepInternal(): Promise<void> {
    try {
      const recycled = await this.fileService.sweepRecycled()
      if (recycled.purged > 0) {
        this.logger.log(`回收站清理：${recycled.owners} 个账号、${recycled.purged} 条记录及其物理文件已删除`)
      }
    } catch (error) {
      this.logger.error(`回收站清理失败：${error instanceof Error ? error.message : String(error)}`)
    }

    try {
      const temp = await this.fileService.sweepTempFiles()
      if (temp.removed > 0) {
        this.logger.warn(`临时文件清理：删除 ${temp.removed} 个上传残留`)
      }
    } catch (error) {
      this.logger.error(`临时文件清理失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
