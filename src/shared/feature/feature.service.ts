import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { SysConfigEntity } from '../../modules/system/config/entities/sys-config.entity'
import { SystemConfigService } from '../../modules/system/config/system-config.service'
import { TenantContext } from '../tenant/tenant.context'

const KEY_PREFIX = 'feature.'
const TRUTHY = new Set(['true', '1', 'yes'])

/**
 * 租户级特性开关（Feature Flags）：
 *
 * 开关即数据——复用 sys_config 的 `feature.*` 键与租户回退链（租户覆盖行 → 平台行 → 关），
 * 不建新表、不引入配置中心。平台在「参数配置」里新增 `feature.xxx` 行（allow_tenant=1）
 * 即得到一个可按租户灰度的开关；租户视角可在额度内自行开关。
 *
 * - `enabled(name)`：端点/逻辑内的运行时判定（配合 @FeatureFlag + FeatureGuard）
 * - `listAll()`：当前租户视角全部生效开关，供前端 `GET /v1/features` 拉取后按 flag 渲染
 */
@Injectable()
export class FeatureService {
  constructor(
    @InjectRepository(SysConfigEntity)
    private readonly repo: Repository<SysConfigEntity>,
    private readonly systemConfig: SystemConfigService
  ) {}

  /** 单个开关是否开启：`feature.<name>`，走 sys_config 租户回退链（带进程内缓存） */
  enabled(name: string): Promise<boolean> {
    return this.systemConfig.getBoolean(`${KEY_PREFIX}${name}`, false)
  }

  /**
   * 当前租户视角的全部生效开关。
   * 平台行 `feature.*` 是全集（覆盖行不会产生新开关），本租户有覆盖行时以覆盖值为准。
   * 返回的键不带 `feature.` 前缀（`log.maskSensitive` 而非 `feature.log.maskSensitive`）。
   */
  async listAll(): Promise<Record<string, boolean>> {
    const tenantId = TenantContext.currentTenantId()
    const platformRows = await this.repo.find({ where: { delFlag: 0, tenantId: 0 } })
    const overrides =
      tenantId !== null && tenantId > 0 ? await this.repo.find({ where: { delFlag: 0, tenantId }, select: { configKey: true, configValue: true } }) : []
    const overrideMap = new Map(overrides.map(row => [row.configKey, row]))

    const result: Record<string, boolean> = {}
    for (const row of platformRows) {
      if (!row.configKey.startsWith(KEY_PREFIX)) continue
      const raw = (overrideMap.get(row.configKey)?.configValue ?? row.configValue ?? '').trim().toLowerCase()
      result[row.configKey.slice(KEY_PREFIX.length)] = TRUTHY.has(raw)
    }
    return result
  }
}
