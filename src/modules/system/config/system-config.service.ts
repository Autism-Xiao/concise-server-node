import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import type { BatchUpdateConfigDto, UpdateConfigItemDto } from './dto/config.dto'
import { SysConfigEntity } from './entities/sys-config.entity'

/** 密码策略（供 auth 模块消费） */
export interface PasswordPolicy {
  /** 最小长度 */
  minLength: number
  /** 是否需要大小写+数字+符号中的三类 */
  requireComplexity: boolean
  /** 有效期（天），0 = 不过期 */
  expireDays: number
  /** 首次登录是否强制改密 */
  forceChangeOnFirstLogin: boolean
  /** 连续失败多少次要锁定 */
  maxFailCount: number
}

/**
 * 代码级默认值：数据库里没有这条配置时用它兜底。
 * 原则是「配置表可以空，系统必须能跑」—— 任何新增参数都必须在这里有默认值，
 * 否则部署到没有该行的环境上会直接抛错。
 */
const DEFAULTS: Record<string, string> = {
  'security.password.minLength': '8',
  'security.password.requireComplexity': 'true',
  'security.password.expireDays': '90',
  'security.password.forceChangeOnFirstLogin': 'false',
  'security.login.maxFailCount': '5'
}

/** 进程内缓存有效期（毫秒）：多实例部署时，别处改的值最多这么久后本实例生效 */
const CACHE_TTL_MS = 30_000

/**
 * 系统参数配置服务
 *
 * 读取路径：进程缓存（30s）→ 数据库 → 代码默认值，三级兜底。
 * 写入后会立即清空本地缓存，但其他实例要等 TTL 过期（参数类配置对此不敏感）。
 */
@Injectable()
export class SystemConfigService {
  private readonly logger = new Logger(SystemConfigService.name)
  private cache = new Map<string, SysConfigEntity>()
  private loadedAt = 0

  constructor(
    @InjectRepository(SysConfigEntity)
    private readonly repo: Repository<SysConfigEntity>
  ) {}

  /** 管理端列表：按分组聚合，附带默认值（库里缺失的也列出来，标 isBuiltin=0 便于发现） */
  async list(group?: string): Promise<Array<Record<string, unknown>>> {
    const rows = await this.repo.find({ where: { delFlag: 0 }, order: { configGroup: 'ASC', id: 'ASC' } })
    const filtered = group ? rows.filter(row => row.configGroup === group) : rows
    return filtered.map(row => ({
      configKey: row.configKey,
      configValue: row.configValue ?? DEFAULTS[row.configKey] ?? '',
      valueType: row.valueType,
      configGroup: row.configGroup,
      name: row.name,
      remark: row.remark,
      isBuiltin: row.isBuiltin
    }))
  }

  /** 分组名列表（前端渲染 Tab 用） */
  async groups(): Promise<string[]> {
    const rows = await this.repo.find({ where: { delFlag: 0 }, select: { configGroup: true } })
    return [...new Set(rows.map(row => row.configGroup))]
  }

  /** 强制刷新缓存（迁移后或手工修库后调用） */
  async reload(): Promise<void> {
    this.cache = new Map()
    this.loadedAt = 0
    await this.ensureLoaded(true)
  }

  async getString(key: string, fallback?: string): Promise<string> {
    const row = await this.getRow(key)
    return row?.configValue ?? DEFAULTS[key] ?? fallback ?? ''
  }

  async getNumber(key: string, fallback = 0): Promise<number> {
    const raw = await this.getString(key, String(fallback))
    const num = Number(raw)
    return Number.isFinite(num) ? num : fallback
  }

  async getBoolean(key: string, fallback = false): Promise<boolean> {
    const raw = (await this.getString(key, String(fallback))).trim().toLowerCase()
    return raw === 'true' || raw === '1' || raw === 'yes'
  }

  async getJson<T>(key: string, fallback: T): Promise<T> {
    const raw = await this.getString(key)
    if (!raw) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      this.logger.warn(`参数 ${key} 不是合法 JSON，回落默认值`)
      return fallback
    }
  }

  /** 密码策略（auth 模块调用，避免它自己拼 5 个 key） */
  async getPasswordPolicy(): Promise<PasswordPolicy> {
    return {
      minLength: await this.getNumber('security.password.minLength', 8),
      requireComplexity: await this.getBoolean('security.password.requireComplexity', true),
      expireDays: await this.getNumber('security.password.expireDays', 90),
      forceChangeOnFirstLogin: await this.getBoolean('security.password.forceChangeOnFirstLogin', false),
      maxFailCount: await this.getNumber('security.login.maxFailCount', 5)
    }
  }

  /** 单条更新：键必须已存在（内置参数），值要符合声明的类型 */
  async updateOne(dto: UpdateConfigItemDto): Promise<void> {
    const row = await this.repo.findOne({ where: { configKey: dto.configKey, delFlag: 0 } })
    if (!row) throw new BadRequestException(`参数 ${dto.configKey} 不存在`)
    const value = dto.configValue ?? ''
    this.assertType(row.valueType, value, row.name)
    await this.repo.update(row.id, { configValue: value })
    this.cache.delete(row.configKey)
    this.loadedAt = 0
    this.logger.log(`参数已更新：${row.configKey} = ${value}`)
  }

  /** 批量更新：整批校验通过才写，避免一半成功一半失败 */
  async updateBatch(dto: BatchUpdateConfigDto): Promise<{ updated: number }> {
    if (!dto.items?.length) throw new BadRequestException('没有要更新的参数')
    const keys = dto.items.map(item => item.configKey)
    const rows = await this.repo.find({ where: { delFlag: 0 } })
    const byKey = new Map(rows.map(row => [row.configKey, row]))
    for (const item of dto.items) {
      const row = byKey.get(item.configKey)
      if (!row) throw new BadRequestException(`参数 ${item.configKey} 不存在`)
      this.assertType(row.valueType, item.configValue ?? '', row.name)
    }
    await this.repo.manager.transaction(async manager => {
      for (const item of dto.items) {
        const row = byKey.get(item.configKey)
        if (!row) continue
        await manager.update(SysConfigEntity, row.id, { configValue: item.configValue ?? '' })
      }
    })
    keys.forEach(key => this.cache.delete(key))
    this.loadedAt = 0
    return { updated: dto.items.length }
  }

  private assertType(valueType: string, value: string, name: string): void {
    if (valueType === 'number') {
      if (value !== '' && !Number.isFinite(Number(value))) throw new BadRequestException(`${name} 必须是数字`)
      return
    }
    if (valueType === 'boolean') {
      if (!['true', 'false'].includes(value)) throw new BadRequestException(`${name} 只能是 true 或 false`)
      return
    }
    if (valueType === 'json' && value) {
      try {
        JSON.parse(value)
      } catch {
        throw new BadRequestException(`${name} 不是合法 JSON`)
      }
    }
  }

  private async getRow(key: string): Promise<SysConfigEntity | undefined> {
    await this.ensureLoaded()
    return this.cache.get(key)
  }

  private async ensureLoaded(force = false): Promise<void> {
    if (!force && this.loadedAt && Date.now() - this.loadedAt < CACHE_TTL_MS) return
    const rows = await this.repo.find({ where: { delFlag: 0 } })
    this.cache = new Map(rows.map(row => [row.configKey, row]))
    this.loadedAt = Date.now()
  }
}
