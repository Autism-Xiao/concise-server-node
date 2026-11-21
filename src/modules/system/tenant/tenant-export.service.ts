import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'

/** 文件元数据导出上限：导出是为了交接/归档盘点，超大的文件清单应走文件中心自己的检索 */
const MAX_FILE_ROWS = 5000

export interface TenantExportBundle {
  /** 导出自述：谁在什么时候用什么格式导的，归档时不用猜 */
  meta: { exportedAt: string; version: 1; format: 'json' }
  tenant: {
    id: number
    name: string
    code: string
    plan: string
    startDate: string | null
    expireDate: string | null
    status: number
    contact: string
    phone: string
    remark: string
    createTime: string | null
  }
  /** 角色定义（含角色码/数据权限），成员的角色绑定单独一份 */
  roles: Array<{ id: string; roleCode: string; roleName: string; dataScope: number; status: number }>
  /** 成员与角色绑定：密码/盐等敏感列不进导出 */
  members: Array<{ userId: string; username: string; realname: string; status: number; joinTime: string | null; roleCodes: string[] }>
  /** 功能套餐：租户被授权的菜单/按钮 id 集合 */
  menus: Array<{ permissionId: string }>
  /** 租户覆盖的配置行（feature.* 与 quota.* 等），平台行不重复导出 */
  configs: Array<{ configKey: string; configValue: string }>
  /** 月度用量（metering 全部账期） */
  usage: Array<{ period: string; metric: string; value: number }>
  /** 文件元数据（不含文件内容/物理路径 hash 之外的敏感信息；上限 MAX_FILE_ROWS） */
  files: Array<{ id: number; name: string; extension: string; mime: string; size: number; isFolder: number; isDeleted: number; createTime: string | null }>
  /** 成员数与文件数汇总，接收方不用数数组 */
  summary: { memberCount: number; roleCount: number; menuCount: number; fileCount: number; usageRows: number }
}

/**
 * 租户数据导出（平台运营）
 *
 * 用途：退租交接、审计归档、迁移核对。只聚合「事实」，不导出任何凭证类数据
 * （密码/盐/token 不出现在任何列里）。文件只导元数据不导内容——文件本体在存储里，
 * 交接时按 name+id 清单去取即可。
 *
 * 全部走参数化原生 SQL 聚合，只读不写；导出量上限见各段注释。
 */
@Injectable()
export class TenantExportService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async export(tenantId: number): Promise<TenantExportBundle> {
    const tenantRows = await this.dataSource.query<
      Array<{
        id: number
        name: string
        code: string
        plan: string
        startDate: string | null
        expireDate: string | null
        status: number
        contact: string
        phone: string
        remark: string
        createTime: string | null
      }>
    >(
      `SELECT id, name, code, plan,
              DATE_FORMAT(begin_date, '%Y-%m-%d') AS startDate,
              DATE_FORMAT(expire_at, '%Y-%m-%d') AS expireDate,
              status, contact, phone, remark,
              DATE_FORMAT(create_time, '%Y-%m-%d %H:%i:%s') AS createTime
         FROM sys_tenant WHERE id = ? AND del_flag = 0`,
      [tenantId]
    )
    const tenant = tenantRows[0]
    if (!tenant) throw new NotFoundException('租户不存在')

    // 角色定义（本租户名下）
    const roles = await this.dataSource.query<Array<{ id: string; roleCode: string; roleName: string; dataScope: number; status: number }>>(
      `SELECT id, role_code AS roleCode, role_name AS roleName, data_scope AS dataScope, status
         FROM sys_role WHERE tenant_id = ?`,
      [tenantId]
    )

    // 成员 + 角色绑定（两次查询内存拼，避免 MySQL ONLY_FULL_GROUP_BY 的聚合麻烦）
    const members = await this.dataSource.query<Array<{ userId: string; username: string; realname: string; status: number; joinTime: string | null }>>(
      `SELECT u.id AS userId, u.username, u.realname, u.status,
              DATE_FORMAT(ut.create_time, '%Y-%m-%d %H:%i:%s') AS joinTime
         FROM sys_user u
         INNER JOIN sys_user_tenant ut ON ut.user_id = u.id AND ut.tenant_id = ?
        WHERE u.del_flag = 0
        ORDER BY ut.create_time ASC, u.id ASC`,
      [tenantId]
    )
    const bindings = await this.dataSource.query<Array<{ user_id: string; role_code: string }>>(
      `SELECT ur.user_id, r.role_code
         FROM sys_user_role ur
         INNER JOIN sys_role r ON r.id = ur.role_id AND r.tenant_id = ?`,
      [tenantId]
    )
    const rolesByUser = new Map<string, string[]>()
    for (const row of bindings) {
      const list = rolesByUser.get(row.user_id) ?? []
      list.push(row.role_code)
      rolesByUser.set(row.user_id, list)
    }

    // 功能套餐（授权菜单集合）
    const menus = await this.dataSource.query<Array<{ permissionId: string }>>(
      `SELECT permission_id AS permissionId FROM sys_tenant_menu WHERE tenant_id = ?`,
      [tenantId]
    )

    // 配置覆盖行：只导租户自己的覆盖（平台行是全局默认，不属于这个租户的数据）
    const configs = await this.dataSource.query<Array<{ configKey: string; configValue: string }>>(
      `SELECT config_key AS configKey, config_value AS configValue
         FROM sys_config WHERE tenant_id = ? AND del_flag = 0`,
      [tenantId]
    )

    // 月度用量（全部账期，行数 = 账期数 × 指标数，天然有限）
    const usage = await this.dataSource.query<Array<{ period: string; metric: string; value: number }>>(
      `SELECT period, metric, value FROM sys_tenant_usage WHERE tenant_id = ? ORDER BY period ASC, metric ASC`,
      [tenantId]
    )

    // 文件元数据（不含内容/物理路径；软删的也导，归档要能看到全貌）
    const files = await this.dataSource.query<
      Array<{ id: number; name: string; extension: string; mime: string; size: number; isFolder: number; isDeleted: number; createTime: string | null }>
    >(
      `SELECT id, name, ext AS extension, mime, size, is_folder AS isFolder, is_deleted AS isDeleted,
              DATE_FORMAT(create_time, '%Y-%m-%d %H:%i:%s') AS createTime
         FROM sys_file WHERE tenant_id = ?
        ORDER BY create_time ASC, id ASC
        LIMIT ${MAX_FILE_ROWS + 1}`,
      [tenantId]
    )
    const fileRows = files.slice(0, MAX_FILE_ROWS)

    return {
      meta: { exportedAt: new Date().toISOString(), version: 1, format: 'json' },
      tenant: {
        id: Number(tenant.id),
        name: tenant.name,
        code: tenant.code,
        plan: tenant.plan,
        startDate: tenant.startDate,
        expireDate: tenant.expireDate,
        status: Number(tenant.status),
        contact: tenant.contact,
        phone: tenant.phone,
        remark: tenant.remark,
        createTime: tenant.createTime
      },
      roles,
      members: members.map(row => ({ ...row, roleCodes: rolesByUser.get(row.userId) ?? [] })),
      menus,
      configs,
      usage,
      files: fileRows,
      summary: {
        memberCount: members.length,
        roleCount: roles.length,
        menuCount: menus.length,
        fileCount: fileRows.length,
        usageRows: usage.length
      }
    }
  }
}
