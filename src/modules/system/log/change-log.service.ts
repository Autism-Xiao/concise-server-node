import { randomId32 } from '../../../utils/password.util'

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'

import { Pagination } from '../../../helper/paginate'
import { registerChangeSink, type ChangeItem } from '../../../shared/audit/change-recorder'
import { TenantContext } from '../../../shared/tenant/tenant.context'
import { SysLogChangeEntity } from './entities/log-change.entity'

/** 单次更新最多记多少行：真有批量改 200 个字段的，记前 100 个并留一条说明 */
const MAX_ITEMS_PER_WRITE = 100

export interface ChangeLogQuery {
  tableName?: string
  recordId?: string
  field?: string
  operateUserId?: string
  startTime?: string
  endTime?: string
  page?: number
  pageSize?: number
}

/** 查询结果：比实体多一个操作人用户名（前端直接展示，不用再查一次用户） */
export interface ChangeLogRow extends SysLogChangeEntity {
  operateUserName?: string | null
}

/**
 * 字段级变更审计服务
 *
 * 采集端：日志模块启动时把自己注册成 `change-recorder` 的 sink，
 * 之后任何走 `BaseService.update()` 的写入都会把「字段前后值」丢进来。
 * 写库失败只告警不抛错 —— 审计挂了也不能让业务改不动数据。
 */
@Injectable()
export class ChangeLogService implements OnModuleInit {
  private readonly logger = new Logger(ChangeLogService.name)

  constructor(
    @InjectRepository(SysLogChangeEntity)
    private readonly repo: Repository<SysLogChangeEntity>
  ) {}

  onModuleInit(): void {
    registerChangeSink(items => {
      // 不 await：业务写路径不该等审计落库
      void this.record(items)
    })
  }

  /** 落库（批量 insert，一字段一行） */
  async record(items: ChangeItem[]): Promise<void> {
    if (!items.length) return
    const tenantId = TenantContext.currentTenantId() ?? 0
    const operateUserId = TenantContext.userId() ?? null
    const createTime = new Date()
    const rows = items.slice(0, MAX_ITEMS_PER_WRITE).map(item => ({
      id: randomId32(),
      tenantId,
      tableName: item.table,
      recordId: item.recordId,
      field: item.field,
      fieldLabel: item.label ?? null,
      oldValue: item.oldValue,
      newValue: item.newValue,
      operateUserId,
      createTime
    }))
    if (items.length > MAX_ITEMS_PER_WRITE) {
      this.logger.warn(`单次写入变更 ${items.length} 个字段，已截断为 ${MAX_ITEMS_PER_WRITE} 条`)
    }
    try {
      await this.repo.insert(rows)
    } catch (error) {
      // 常见原因：表还没建（迁移没跑）。只告警，不影响业务
      this.logger.warn(`变更审计写入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 分页查询；带租户过滤（与 sys_log 一致：tenantId=0 的记录只有平台管理员看得到） */
  async list(query: ChangeLogQuery): Promise<Pagination<ChangeLogRow>> {
    const page = Math.max(1, Math.trunc(Number(query.page) || 1))
    const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(query.pageSize) || 20)))

    const qb = this.repo.createQueryBuilder('c')
    if (query.tableName) qb.andWhere('c.table_name = :tableName', { tableName: query.tableName })
    if (query.recordId) qb.andWhere('c.record_id = :recordId', { recordId: query.recordId })
    if (query.field) qb.andWhere('c.field = :field', { field: query.field })
    if (query.operateUserId) qb.andWhere('c.operate_user_id = :operateUserId', { operateUserId: query.operateUserId })
    if (query.startTime) qb.andWhere('c.create_time >= :startTime', { startTime: new Date(query.startTime) })
    if (query.endTime) qb.andWhere('c.create_time <= :endTime', { endTime: new Date(query.endTime) })

    const tenantId = TenantContext.filterTenantId()
    if (tenantId !== null) qb.andWhere('c.tenant_id = :tenantId', { tenantId })

    const rows = await qb
      .orderBy('c.create_time', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount()

    const [list, total] = rows
    const named = await this.attachUserNames(list)
    // 这里不能用 toPagination（它按入参数组长度算 total），分页在库侧做了
    return new Pagination<ChangeLogRow>(named, total, page, pageSize)
  }

  /** 某条记录的变更历史（详情页/弹窗用，按时间正序） */
  async listByRecord(tableName: string, recordId: string): Promise<ChangeLogRow[]> {
    const qb = this.repo.createQueryBuilder('c').where('c.table_name = :tableName', { tableName }).andWhere('c.record_id = :recordId', { recordId })
    const tenantId = TenantContext.filterTenantId()
    if (tenantId !== null) qb.andWhere('c.tenant_id = :tenantId', { tenantId })
    const rows = await qb.orderBy('c.create_time', 'ASC').addOrderBy('c.id', 'ASC').getMany()
    return this.attachUserNames(rows)
  }

  /** 操作人用户名一次性补齐（避免前端每行再请求一次用户接口） */
  private async attachUserNames(rows: SysLogChangeEntity[]): Promise<ChangeLogRow[]> {
    const ids = [...new Set(rows.map(row => row.operateUserId).filter((id): id is string => !!id))]
    if (!ids.length) return rows
    try {
      const found: Array<{ id: string; username: string }> = await this.repo.manager.query(
        `SELECT id, username FROM sys_user WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      )
      const byId = new Map(found.map(row => [row.id, row.username]))
      return rows.map(row => Object.assign(row, { operateUserName: row.operateUserId ? (byId.get(row.operateUserId) ?? null) : null }))
    } catch {
      return rows
    }
  }
}
