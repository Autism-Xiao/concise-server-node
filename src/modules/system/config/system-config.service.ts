import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { EntityManager, Repository } from 'typeorm'
import { isDuplicateEntryError } from '../../../utils/db-error.util'
import { TenantContext } from '../../../shared/tenant/tenant.context'
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
  'security.login.maxFailCount': '5',
  // 平台级：未绑定 TOTP 的超管是否只能登录不能执行平台级操作（详情见 PermsGuard / AuthService.needsSuperMfa）
  'security.platformAdmin.require2fa': 'false',
  // 邮件通道：SMTP 连接信息走环境变量（MAIL_SMTP_*），这里只有开关与展示项
  'mail.enabled': 'false',
  'mail.from': '',
  'mail.resetCode.ttlMinutes': '5',
  // 租户级参数（allow_tenant=1，租户覆盖为空串等同跟随平台）
  'tenant.ui.themeColor': '',
  'tenant.login.welcomeText': '',
  // 平台级：一个 VIP 账号最多能自助开通几个租户（0 或负数视为不限制，仅在代码侧兜底）
  'tenant.vip.maxTenants': '1',
  // 租户资源配额（allow_tenant=1；0 = 不限制，升级后存量租户行为不变）
  'tenant.quota.maxUsers': '0',
  'tenant.quota.maxStorageMb': '0',
  // 特性开关（feature.*，allow_tenant=1）：日志脱敏默认关（存量行为不变）；监管权限默认开（kill switch）
  'feature.log.maskSensitive': '0',
  'feature.rbac.superviseDept': '1',
  // 记住登录凭证（方案 C）：默认开；关掉后不再签发、存量凭证换取也会被拒（fail-safe）
  'feature.auth.rememberMe': '1'
}

/** 进程内缓存有效期（毫秒）：多实例部署时，别处改的值最多这么久后本实例生效 */
const CACHE_TTL_MS = 30_000

/**
 * 系统参数配置服务（租户两级）
 *
 * 读取回退链：租户覆盖行（tenant_id=本租户）→ 平台行（tenant_id=0）→ 代码默认值 → 调用方 fallback。
 * 平台视角（tenantId=null/0）读写都落在平台行；租户视角只能改 allow_tenant=1 的参数，
 * 首次写入会按平台行的元数据生成一条租户覆盖行（联合唯一 (tenant_id, config_key) 兜底）。
 */
/** 写目标：平台行必查（键元数据来源），租户视角额外定位已有覆盖行 */
interface WriteTarget {
  /** 生效租户：0=平台视角，>0=租户视角 */
  tenantId: number
  platformRow: SysConfigEntity
  tenantRow: SysConfigEntity | null
}

@Injectable()
export class SystemConfigService {
  private readonly logger = new Logger(SystemConfigService.name)
  /** 缓存键 = `${tenantId}::${configKey}`，一次加载全量（参数行数少，含各租户覆盖行） */
  private cache = new Map<string, SysConfigEntity>()
  private loadedAt = 0

  constructor(
    @InjectRepository(SysConfigEntity)
    private readonly repo: Repository<SysConfigEntity>
  ) {}

  /** 管理端列表：平台视角列平台行；租户视角列生效值（租户覆盖优先）并标注覆盖状态 */
  async list(group?: string): Promise<Array<Record<string, unknown>>> {
    const platformRows = await this.repo.find({ where: { delFlag: 0, tenantId: 0 }, order: { configGroup: 'ASC', id: 'ASC' } })
    const tenantId = this.currentTenantId()
    const tenantRows = tenantId > 0 ? await this.repo.find({ where: { delFlag: 0, tenantId } }) : []
    const tenantByKey = new Map(tenantRows.map(row => [row.configKey, row]))

    const filtered = group ? platformRows.filter(row => row.configGroup === group) : platformRows
    return filtered.map(row => {
      const tenantRow = tenantByKey.get(row.configKey)
      const platformValue = row.configValue ?? DEFAULTS[row.configKey] ?? ''
      return {
        configKey: row.configKey,
        configValue: tenantRow ? (tenantRow.configValue ?? '') : platformValue,
        valueType: row.valueType,
        configGroup: row.configGroup,
        name: row.name,
        remark: row.remark,
        isBuiltin: row.isBuiltin,
        allowTenant: row.allowTenant,
        // 租户视角附带：平台参考值 + 是否已覆盖（便于前端展示「已覆盖/跟随平台」）
        platformValue,
        tenantConfigured: Boolean(tenantRow)
      }
    })
  }

  /** 分组名列表（前端渲染 Tab 用，只看平台行——租户覆盖不会产生新分组） */
  async groups(): Promise<string[]> {
    const rows = await this.repo.find({ where: { delFlag: 0, tenantId: 0 }, select: { configGroup: true } })
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

  /** 单条更新：平台视角改平台行；租户视角改/建自己的覆盖行（仅 allow_tenant=1） */
  async updateOne(dto: UpdateConfigItemDto): Promise<void> {
    const target = await this.resolveWrite(dto.configKey)
    const value = dto.configValue ?? ''
    this.assertType(target.platformRow.valueType, value, target.platformRow.name)
    await this.writeValue(target, value, this.repo.manager)
    this.invalidate()
    this.logger.log(`参数已更新（tenant=${target.tenantId}）：${dto.configKey} = ${value}`)
  }

  /** 批量更新：整批校验通过才写，避免一半成功一半失败 */
  async updateBatch(dto: BatchUpdateConfigDto): Promise<{ updated: number }> {
    if (!dto.items?.length) throw new BadRequestException('没有要更新的参数')
    const targets = [] as Array<{ target: WriteTarget; value: string }>
    for (const item of dto.items) {
      const target = await this.resolveWrite(item.configKey)
      const value = item.configValue ?? ''
      this.assertType(target.platformRow.valueType, value, target.platformRow.name)
      targets.push({ target, value })
    }
    await this.repo.manager.transaction(async manager => {
      for (const { target, value } of targets) {
        await this.writeValue(target, value, manager)
      }
    })
    this.invalidate()
    return { updated: dto.items.length }
  }

  /** 租户视角取消覆盖（删除自己的覆盖行，回到跟随平台）；平台视角无可重置 */
  async resetOverride(configKey: string): Promise<void> {
    const tenantId = this.currentTenantId()
    if (tenantId <= 0) throw new BadRequestException('平台视角没有租户覆盖，无需重置')
    const result = await this.repo.delete({ configKey, tenantId })
    if (!result.affected) throw new BadRequestException(`参数 ${configKey} 没有租户覆盖值`)
    this.invalidate()
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

  /** 写目标定位：平台行必查（键元数据来源），租户视角额外定位已有覆盖行 */
  private async resolveWrite(configKey: string): Promise<WriteTarget> {
    const platformRow = await this.repo.findOne({ where: { configKey, tenantId: 0, delFlag: 0 } })
    if (!platformRow) throw new BadRequestException(`参数 ${configKey} 不存在`)
    const tenantId = this.currentTenantId()
    if (tenantId <= 0) {
      return { tenantId: 0, platformRow, tenantRow: null }
    }
    if (platformRow.allowTenant !== 1) {
      throw new BadRequestException(`参数「${platformRow.name}」为平台级参数，租户不可修改`)
    }
    const tenantRow = await this.repo.findOne({ where: { configKey, tenantId, delFlag: 0 } })
    return { tenantId, platformRow, tenantRow }
  }

  /** 执行写入：租户视角 upsert 覆盖行（元数据抄平台行），平台视角直接更新平台行 */
  private async writeValue(target: WriteTarget, value: string, manager: EntityManager): Promise<void> {
    if (target.tenantId <= 0) {
      await manager.update(SysConfigEntity, target.platformRow.id, { configValue: value })
      return
    }
    if (target.tenantRow) {
      await manager.update(SysConfigEntity, target.tenantRow.id, { configValue: value })
      return
    }
    const src = target.platformRow
    try {
      await manager.insert(SysConfigEntity, {
        configKey: src.configKey,
        tenantId: target.tenantId,
        configValue: value,
        valueType: src.valueType,
        configGroup: src.configGroup,
        name: src.name,
        remark: src.remark,
        isBuiltin: 0,
        allowTenant: 0,
        delFlag: 0
      })
    } catch (error) {
      // 并发下撞 (tenant_id, config_key) 联合唯一：转可读报错
      if (isDuplicateEntryError(error)) {
        throw new BadRequestException(`参数 ${src.configKey} 已有租户覆盖值，请勿重复创建`)
      }
      throw error
    }
  }

  /** 当前生效租户：null（平台超管未指定）/ 0（无归属账号）都按平台 0 处理 */
  private currentTenantId(): number {
    return TenantContext.filterTenantId() ?? 0
  }

  private async getRow(key: string): Promise<SysConfigEntity | undefined> {
    await this.ensureLoaded()
    const tenantId = this.currentTenantId()
    return this.cache.get(`${tenantId}::${key}`) ?? (tenantId > 0 ? this.cache.get(`0::${key}`) : undefined)
  }

  private async ensureLoaded(force = false): Promise<void> {
    if (!force && this.loadedAt && Date.now() - this.loadedAt < CACHE_TTL_MS) return
    const rows = await this.repo.find({ where: { delFlag: 0 } })
    this.cache = new Map(rows.map(row => [`${row.tenantId}::${row.configKey}`, row]))
    this.loadedAt = Date.now()
  }

  /** 任何写入后整表失效（参数行数少，整表重建成本可忽略；平台行变更会影响所有租户的回退结果） */
  private invalidate(): void {
    this.cache = new Map()
    this.loadedAt = 0
  }
}
