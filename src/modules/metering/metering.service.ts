import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { TenantContext } from '../../shared/tenant/tenant.context'
import { TenantUsageEntity } from './entities/tenant-usage.entity'

/** 攒批阈值：30 秒或 500 条先到先刷，进程正常关闭时再刷一次 */
const FLUSH_INTERVAL_MS = 30_000
const MAX_BUFFER_KEYS = 500

/** 账期键：本地时区 YYYYMM（与前端展示、财务月结保持一致） */
export function usagePeriod(now = new Date()): string {
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 租户用量计量（Metering）
 *
 * 为什么不是 Redis INCR：Redis 可关闭（本地/CI 默认关），而用量是要留作账单底稿的数据；
 * 直接落 MySQL 的原子 upsert，多实例安全，也不依赖缓存持久化策略。
 *
 * 写路径只在内存里累加，定时批量 upsert；进程被 kill -9 时最多丢一个窗口的计数，
 * 因此这些数字适合「用量展示与超额告警」，精确计费应再对账业务表（sys_file / sys_log）。
 * 匿名与平台视角（tenantId<=0）一律不记，避免把全站流量算到某个租户头上。
 */
@Injectable()
export class MeteringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeteringService.name)
  private buffer = new Map<string, number>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    @InjectRepository(TenantUsageEntity)
    private readonly repo: Repository<TenantUsageEntity>
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS)
    // 计时器不该阻止进程退出
    this.timer.unref?.()
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.flush()
  }

  /** 记录一次消耗；metric 用点分命名（api.calls / file.upload.bytes） */
  record(metric: string, delta = 1, tenantId?: number | null): void {
    const tenant = tenantId === undefined ? TenantContext.filterTenantId() : tenantId
    if (!(tenant && tenant > 0) || !(delta > 0) || !metric) return
    const key = `${tenant}|${metric}|${usagePeriod()}`
    this.buffer.set(key, (this.buffer.get(key) ?? 0) + delta)
    if (this.buffer.size >= MAX_BUFFER_KEYS) void this.flush()
  }

  /** 把内存缓冲刷到库：单条 SQL 批量 upsert，失败则整批退回缓冲，下次重试 */
  async flush(): Promise<void> {
    if (this.buffer.size === 0) return
    const batch = [...this.buffer.entries()]
    this.buffer = new Map()

    const placeholders = batch.map(() => '(?, ?, ?, ?)').join(',')
    const params: Array<string | number> = []
    for (const [key, value] of batch) {
      const [tenant, metric, period] = key.split('|')
      params.push(Number(tenant), metric, period, value)
    }
    try {
      await this.repo.query(
        `INSERT INTO \`sys_tenant_usage\` (\`tenant_id\`, \`metric\`, \`period\`, \`value\`) VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE \`value\` = \`value\` + VALUES(\`value\`)`,
        params
      )
    } catch (error) {
      // 整批失败：合回缓冲（不拆分，避免部分成功导致重复加）
      for (const [key, value] of batch) {
        this.buffer.set(key, (this.buffer.get(key) ?? 0) + value)
      }
      this.logger.warn(`用量落库失败，已回退缓冲等待重试：${(error as Error).message}`)
    }
  }

  /** 查询某租户某月全部指标（key → value） */
  async usage(tenantId: number, period = usagePeriod()): Promise<Record<string, number>> {
    if (!(tenantId > 0)) return {}
    const rows = await this.repo.find({ where: { tenantId, period } })
    return Object.fromEntries(rows.map(row => [row.metric, row.value]))
  }
}
