import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'

import { SystemConfigService } from '../../modules/system/config/system-config.service'
import { TenantContext } from '../tenant/tenant.context'

/** 配额配置键（与 sys_config 平台行、SystemConfigService.DEFAULTS 保持一致） */
export const QUOTA_KEYS = {
  maxUsers: 'tenant.quota.maxUsers',
  maxStorageMb: 'tenant.quota.maxStorageMb'
} as const

/**
 * 租户资源配额服务
 *
 * 两个口径：
 * - 用户数：sys_user_tenant.status=0 且 sys_user.del_flag=0（与「删除租户前校验」一致；
 *   login_tenant_id 只是上次登录选择，不能当归属用）。
 * - 存储：sys_file 中「本租户 + 未进回收站 + 非文件夹」的 size 之和。
 *   严格只看本租户，不含 tenant_id=0 的共享行；与个人配额（applyTenantScope 含共享）口径不同，
 *   因为租户配额算的是这个租户自己占用的资源。
 *
 * 0 / 负数 = 不限制。平台视角（tenantId<=0）不做配额判断，避免把平台共享数据误算进某个租户。
 * 计数用参数化原生 SQL 做聚合，不涉及任何写路径，也不拼接用户输入。
 */
@Injectable()
export class QuotaService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: SystemConfigService
  ) {}

  /** 按「目标租户」读配置：平台代管时必须读该租户的覆盖行，而不是平台行的值 */
  private limitFor(tenantId: number, key: string): Promise<number> {
    return TenantContext.withTenant(tenantId, () => this.config.getNumber(key, 0))
  }

  /** 建号前调用：extra = 本次要新增的成员数（批量加入时传实际新增数） */
  async assertUserQuota(tenantId: number, extra = 1): Promise<void> {
    if (!(tenantId > 0) || extra <= 0) return
    const limit = await this.limitFor(tenantId, QUOTA_KEYS.maxUsers)
    if (!(limit > 0)) return

    const rows = await this.dataSource.query<Array<{ c: number | string }>>(
      `SELECT COUNT(*) AS c
         FROM sys_user_tenant ut
         INNER JOIN sys_user u ON u.id = ut.user_id AND u.del_flag = 0
        WHERE ut.tenant_id = ? AND ut.status = 0`,
      [tenantId]
    )
    const used = Number(rows[0]?.c ?? 0)
    if (used + extra > limit) {
      throw new BadRequestException(`租户用户数已达上限：当前 ${used} 人，上限 ${limit} 人，本次新增 ${extra} 人`)
    }
  }

  /** 上传前调用：extraBytes = 本次新增字节数（覆盖上传传差值） */
  async assertStorageQuota(tenantId: number, extraBytes: number): Promise<void> {
    if (!(tenantId > 0) || !(extraBytes > 0)) return
    const limitMb = await this.limitFor(tenantId, QUOTA_KEYS.maxStorageMb)
    if (!(limitMb > 0)) return
    const limitBytes = limitMb * 1024 * 1024

    const rows = await this.dataSource.query<Array<{ c: number | string }>>(
      'SELECT COALESCE(SUM(f.size), 0) AS c FROM sys_file f WHERE f.tenant_id = ? AND f.is_deleted = 0 AND f.is_folder = 0',
      [tenantId]
    )
    const used = Number(rows[0]?.c ?? 0)
    if (used + extraBytes > limitBytes) {
      throw new BadRequestException(`租户存储空间不足：当前 ${(used / 1024 / 1024).toFixed(2)} MB，上限 ${limitMb} MB`)
    }
  }
}
