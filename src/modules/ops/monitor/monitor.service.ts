import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { statfs } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import * as os from 'node:os'

import { RedisService } from '../../../shared/redis/redis.service'

export interface DiskInfo {
  name: string
  /** 总容量（GB，保留 1 位小数） */
  total: number
  /** 已用（GB，保留 1 位小数） */
  used: number
  /** 使用率百分比 */
  usage: number
}

export interface ServerInfo {
  host: { hostname: string; os: string; arch: string; ip: string; uptime: string }
  cpu: { model: string; cores: number; usage: number }
  memory: { total: number; used: number; usage: number }
  node: { version: string; memoryUsage: number; uptime: string }
  disks: DiskInfo[]
}

export interface CacheKeyStat {
  name: string
  count: number
  ttl: string
  description: string
}

export interface CacheInfo {
  mode: string
  keyCount: number
  memoryUsed: string
  hitRate: number
  keys: CacheKeyStat[]
}

/** 本项目会写入的 key 前缀，清理时按这些前缀动手，避免误删其他库数据 */
const APP_PREFIXES = ['online:session:', 'online:revoked:', 'captcha:']
const PREFIX_DESCRIPTIONS: Record<string, string> = {
  'online:session:': '在线会话（登录令牌）',
  'online:revoked:': '强制下线令牌黑名单',
  'captcha:': '图形验证码',
  'job:': '定时任务运行态'
}

/** CPU 采样窗口：太短抖动大，太长则首页显示的是几秒前的值 */
const CPU_SAMPLE_WINDOW_MS = 200
/** CPU 后台采样间隔（可用 MONITOR_CPU_SAMPLE_MS 覆盖） */
const CPU_SAMPLE_INTERVAL_MS = 5000

/**
 * 取正整数环境变量，非法值回落到默认
 */
function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback
}

/**
 * 运维监控（JeecgBoot 这两个页面都没有表：服务监控走系统 API 实时采集，缓存监控走 Redis INFO）
 * 本项目保持一致：不落库，全部实时读取。
 *
 * CPU 使用率改成**后台定时采样 + 读缓存**：原来每次 getServerInfo 都 `await 200ms` 做两次
 * os.cpus() 差值，首页概览每个请求都要多等 200ms（p50 216ms 里几乎全是它）。
 * 现在进程内每 5 秒采一次，接口直接返回最近一次的值（误差 ≤ 5 秒，监控场景完全够用）。
 */
@Injectable()
export class MonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitorService.name)

  /** 最近一次采样得到的 CPU 使用率（%，1 位小数）；进程刚启动、还没采到值时为 0 */
  private cpuUsage = 0
  private cpuTimer?: NodeJS.Timeout
  private cpuSampling = false

  constructor(private readonly redis: RedisService) {}

  onModuleInit(): void {
    // 立即采一次，避免启动后前几秒首页显示 0%
    void this.sampleCpuUsage()
    this.cpuTimer = setInterval(() => void this.sampleCpuUsage(), positiveInt(process.env.MONITOR_CPU_SAMPLE_MS, CPU_SAMPLE_INTERVAL_MS))
    // unref：定时器不该拖住进程退出（测试/脚本里 import 了这个 service 也一样）
    this.cpuTimer.unref?.()
  }

  onModuleDestroy(): void {
    if (this.cpuTimer) {
      clearInterval(this.cpuTimer)
      this.cpuTimer = undefined
    }
  }

  /** 服务监控：主机 / CPU / 内存 / Node 进程 / 磁盘 */
  async getServerInfo(): Promise<ServerInfo> {
    const totalMemory = os.totalmem()
    const freeMemory = os.freemem()
    const usedMemory = totalMemory - freeMemory
    const cpuList = os.cpus()

    return {
      host: {
        hostname: os.hostname(),
        os: `${os.type()} ${os.release()}`,
        arch: os.arch(),
        ip: this.localIp(),
        uptime: this.formatDuration(os.uptime())
      },
      cpu: {
        model: cpuList[0]?.model?.trim() ?? '未知',
        cores: cpuList.length,
        // 读后台采样的缓存值：不再在这里等 200ms
        usage: this.cpuUsage
      },
      memory: {
        total: this.toMb(totalMemory),
        used: this.toMb(usedMemory),
        usage: this.toPercent(usedMemory, totalMemory)
      },
      node: {
        version: process.version,
        memoryUsage: this.toMb(process.memoryUsage().rss),
        uptime: this.formatDuration(process.uptime())
      },
      disks: await this.listDisks()
    }
  }

  /** 缓存监控：Redis INFO + 前缀统计 */
  async getCacheInfo(): Promise<CacheInfo> {
    const client = this.redis.client
    if (!this.redis.enabled || !client) {
      return { mode: 'Redis 未启用（REDIS_ENABLED=false）', keyCount: 0, memoryUsed: '-', hitRate: 0, keys: [] }
    }

    try {
      const info = await client.info()
      const version = this.infoValue(info, 'redis_version')
      const usedMemory = this.infoValue(info, 'used_memory_human')
      const hits = Number(this.infoValue(info, 'keyspace_hits') ?? 0)
      const misses = Number(this.infoValue(info, 'keyspace_misses') ?? 0)
      const keyCount = await client.dbsize()

      return {
        mode: `Redis ${version || ''}`.trim(),
        keyCount,
        memoryUsed: usedMemory || '-',
        hitRate: hits + misses > 0 ? Math.round((hits / (hits + misses)) * 1000) / 10 : 0,
        keys: await this.groupKeys()
      }
    } catch (error) {
      this.logger.warn(`缓存信息读取失败：${(error as Error).message}`)
      return { mode: 'Redis 连接异常', keyCount: 0, memoryUsed: '-', hitRate: 0, keys: [] }
    }
  }

  /** 清理缓存：按前缀删除；不传前缀时只清本项目自己的 key 前缀 */
  async clearCache(prefix?: string): Promise<{ cleared: number; prefixes: string[] }> {
    const client = this.redis.client
    if (!this.redis.enabled || !client) {
      return { cleared: 0, prefixes: [] }
    }
    const prefixes = prefix ? [prefix] : APP_PREFIXES
    let cleared = 0
    for (const item of prefixes) {
      let cursor = '0'
      do {
        const [next, batch] = await client.scan(cursor, 'MATCH', `${item}*`, 'COUNT', 200)
        cursor = next
        if (batch.length) {
          cleared += await client.del(...batch)
        }
      } while (cursor !== '0')
    }
    return { cleared, prefixes }
  }

  /** 按 key 前缀分组统计数量与 TTL（每个前缀抽样 20 个 key 取最大 TTL，避免全量 TTL 查询） */
  private async groupKeys(): Promise<CacheKeyStat[]> {
    const client = this.redis.client
    if (!client) return []

    const groups = new Map<string, string[]>()
    let cursor = '0'
    do {
      const [next, batch] = await client.scan(cursor, 'MATCH', '*', 'COUNT', 200)
      cursor = next
      for (const key of batch) {
        const prefix = this.prefixOf(key)
        const list = groups.get(prefix) ?? []
        if (list.length < 5000) list.push(key)
        groups.set(prefix, list)
      }
    } while (cursor !== '0')

    const stats: CacheKeyStat[] = []
    for (const [prefix, keys] of groups) {
      const sample = keys.slice(0, 20)
      let maxTtl = -2
      try {
        const pipeline = client.pipeline()
        for (const key of sample) {
          pipeline.ttl(key)
        }
        const results = await pipeline.exec()
        for (const [error, value] of results ?? []) {
          if (!error && typeof value === 'number' && value > maxTtl) {
            maxTtl = value
          }
        }
      } catch {
        maxTtl = -2
      }
      stats.push({
        name: prefix,
        count: keys.length,
        ttl: this.describeTtl(maxTtl),
        description: PREFIX_DESCRIPTIONS[prefix] ?? '业务缓存'
      })
    }
    return stats.sort((a, b) => b.count - a.count)
  }

  private describeTtl(ttl: number): string {
    if (ttl === -1) return '永不过期'
    if (ttl === -2) return '未设置'
    if (ttl >= 3600) return `最长 ${Math.round(ttl / 3600)} 小时`
    if (ttl >= 60) return `最长 ${Math.round(ttl / 60)} 分钟`
    return `最长 ${ttl} 秒`
  }

  /**
   * key 归属的前缀分组
   *
   * 优先按已知业务前缀最长匹配（online:session: / online:revoked: / captcha:），
   * 否则退化为一级前缀（foo:bar:baz → foo:），保证陌生 key 也能分组统计。
   * 注意不能简单取「前两段」——captcha:abc123 只有一段业务前缀，会被切成 captcha:abc123:。
   */
  private prefixOf(key: string): string {
    const known = Object.keys(PREFIX_DESCRIPTIONS).find(prefix => key.startsWith(prefix))
    if (known) return known
    return key.includes(':') ? `${key.split(':')[0]}:` : key
  }

  /** 取本机第一个非内网回环 IPv4 */
  private localIp(): string {
    for (const interfaces of Object.values(os.networkInterfaces())) {
      for (const item of interfaces ?? []) {
        if (item.family === 'IPv4' && !item.internal) {
          return item.address
        }
      }
    }
    return '127.0.0.1'
  }

  /**
   * CPU 使用率采样：两次 os.cpus() 取空闲差（本机瞬时值，非平均值）
   *
   * 由后台定时器调用，结果写进 cpuUsage 供接口读取；并发保护用 cpuSampling 标记，
   * 避免采样间隔被调得很短时同时挂多个 200ms 窗口。
   */
  private async sampleCpuUsage(): Promise<void> {
    if (this.cpuSampling) {
      return
    }
    this.cpuSampling = true
    try {
      const start = this.cpuTimes()
      await new Promise(resolve => setTimeout(resolve, CPU_SAMPLE_WINDOW_MS))
      const end = this.cpuTimes()
      const total = end.total - start.total
      const idle = end.idle - start.idle
      if (total > 0) {
        this.cpuUsage = Math.round((1 - idle / total) * 1000) / 10
      }
    } finally {
      this.cpuSampling = false
    }
  }

  private cpuTimes(): { idle: number; total: number } {
    let idle = 0
    let total = 0
    for (const cpu of os.cpus()) {
      const times = cpu.times
      idle += times.idle
      total += times.user + times.nice + times.sys + times.irq + times.idle
    }
    return { idle, total }
  }

  /** 磁盘：Windows 遍历 C~H 盘符，类 Unix 取根分区 */
  private async listDisks(): Promise<DiskInfo[]> {
    const candidates = process.platform === 'win32' ? ['C:', 'D:', 'E:', 'F:', 'G:', 'H:'].map(drive => `${drive}\\`) : ['/']
    const disks: DiskInfo[] = []
    for (const root of candidates) {
      if (!existsSync(root)) continue
      try {
        const stat = await statfs(root)
        const total = stat.bsize * stat.blocks
        const free = stat.bsize * stat.bavail
        const used = total - free
        disks.push({
          name: root,
          total: Math.round((total / 1024 ** 3) * 10) / 10,
          used: Math.round((used / 1024 ** 3) * 10) / 10,
          usage: this.toPercent(used, total)
        })
      } catch {
        // 无权限或特殊分区跳过
      }
    }
    return disks
  }

  private infoValue(info: string, key: string): string | undefined {
    const line = info.split(/\r?\n/).find(item => item.startsWith(`${key}:`))
    return line ? line.slice(key.length + 1).trim() : undefined
  }

  private toMb(bytes: number): number {
    return Math.round(bytes / 1024 / 1024)
  }

  private toPercent(part: number, total: number): number {
    if (!total) return 0
    return Math.round((part / total) * 1000) / 10
  }

  private formatDuration(seconds: number): string {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (days > 0) return `${days} 天 ${hours} 小时`
    if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
    return `${minutes} 分钟`
  }
}
