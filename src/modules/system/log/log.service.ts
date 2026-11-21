import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, type DeleteQueryBuilder, type SelectQueryBuilder } from 'typeorm'

import { BizErrorCode } from '../../../common/enums/biz-error-code.enum'
import { BizException } from '../../../common/exceptions/biz.exception'
import { assertImportRows, createImportResult, failImportRow, type ImportResult, pickCell, resolveImportLayout } from '../../../helper/import/excel-import'
import { applySort, paginate, type Pagination } from '../../../helper/paginate'
import { TenantContext } from '../../../shared/tenant/tenant.context'
import { RedisService } from '../../../shared/redis/redis.service'
import { randomId32 } from '../../../utils/password.util'
import { parseRequestInfo } from '../../../utils/request-info.util'
import { computeEntryHash, type AuditChainRow } from './audit-chain.util'
import { SysLogEntity } from './entities/sys-log.entity'

/** 可排序字段白名单：前端列 id → 实体属性名（日志量大，服务端排序比拉全量后排更稳） */
const LOG_SORTABLE: Record<string, string> = {
  createTime: 'createTime',
  status: 'status',
  cost: 'cost',
  operateUserName: 'operateUserName'
}

/** 登录日志入参（status 取值：0 成功 / 1 失败） */
export interface LoginLogInput {
  /** 账号校验通过后的用户 ID（用于按人检索登录日志）；账号不存在时为空 */
  userId?: string
  username: string
  status: number
  message: string
  ip: string
  userAgent?: string
  /** 归属租户（不传则按用户当前登录租户推导，见 resolveLoginTenant） */
  tenantId?: number
}

/** 操作日志入参（status 取值：0 成功 / 1 失败） */
export interface OperLogInput {
  userId?: string
  username?: string
  module: string
  action: string
  operateType?: number
  ip: string
  params?: string
  status: number
  errorMsg?: string
  elapsed: number
  /** 归属租户：0 表示平台视角下的操作（仅平台管理员可见） */
  tenantId?: number
  /** 代维标记：不传时按 TenantContext.isProxy() 自动推导 */
  isProxy?: number
}

/** 无租户归属时的兜底租户（默认租户） */
const DEFAULT_TENANT_ID = 1

/**
 * 日志服务：
 * 登录日志 log_type=0、操作日志 log_type=1 共用一张表；
 * status 取值 0 正常（成功）/ 1 异常（失败）。
 * 写入失败只打日志不上抛——日志永远不能影响业务主流程
 */
@Injectable()
export class LogService {
  constructor(
    @InjectRepository(SysLogEntity)
    private readonly logRepository: Repository<SysLogEntity>,
    private readonly redis: RedisService
  ) {}

  /**
   * 审计哈希链写入槽：**插入与封印整体持锁**。
   * 锁顺序 = seq 分配顺序（AUTO_INCREMENT 在锁内分配），保证 prev 永不分叉；
   * 若只在锁内封印、锁外插入，两个并发写可能以相反顺序封印，造成链分叉。
   *
   * 抢锁失败重试 50 次（100ms 间隔，约 5 秒）；仍拿不到或 Redis 不可用则退化为
   * 无锁直写（可能分叉，校验端如实报出）——审计封印绝不能阻塞业务写路径。
   */
  private async chainSlot<T>(tenantId: number, fn: () => Promise<T>): Promise<T> {
    const client = this.redis.client
    if (!client) return fn()
    const key = `audit:chain:${tenantId}`
    const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`
    for (let attempt = 0; attempt < 50; attempt++) {
      const acquired = await client.set(key, token, 'EX', 10, 'NX').catch(() => null)
      if (acquired === 'OK') {
        try {
          return await fn()
        } finally {
          await client
            .eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end', 1, key, token)
            .catch(() => undefined)
        }
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return fn()
  }

  /** 插入 + 封印（必须在同一锁槽内，见 chainSlot 注释） */
  private async insertSealed(entity: SysLogEntity): Promise<void> {
    await this.chainSlot(entity.tenantId, async () => {
      await this.logRepository.save(entity)
      if (process.env.AUDIT_CHAIN_ENABLED === 'false') return
      try {
        // 拿自增 seq 与落库后的 create_time：哈希必须用「库里实际存的值」——datetime 会截断毫秒，
        // 用 JS Date（含 ms）算哈希的话，校验端用库值重算必然对不上（首个冒烟就栽在这里）
        const seqRows = await this.logRepository.query<Array<{ seq: number | string; create_time: Date | string }>>(
          'SELECT seq, create_time FROM sys_log WHERE id = ?',
          [entity.id]
        )
        const seqRow = seqRows[0] as { seq?: number | string; create_time?: Date | string } | undefined
        const seq = Number(seqRow?.seq)
        if (!Number.isFinite(seq)) return

        const prevRows = await this.logRepository.query<Array<{ entry_hash: string | null }>>(
          `SELECT entry_hash FROM sys_log
            WHERE tenant_id = ? AND seq < ? AND entry_hash IS NOT NULL
            ORDER BY seq DESC LIMIT 1`,
          [entity.tenantId, seq]
        )
        const prevHash = prevRows[0]?.entry_hash ?? null

        const row: AuditChainRow = {
          seq,
          tenantId: entity.tenantId,
          id: entity.id,
          logType: entity.logType,
          operateType: entity.operateType ?? null,
          operateUserId: entity.operateUserId ?? null,
          operateUserName: entity.operateUserName ?? null,
          ip: entity.ip ?? '',
          status: entity.status,
          params: entity.params ?? null,
          errorMsg: entity.errorMsg ?? null,
          createTimeMs: new Date(seqRow?.create_time as Date | string).getTime()
        }
        const entryHash = computeEntryHash(prevHash, row)
        await this.logRepository.query('UPDATE sys_log SET prev_hash = ?, entry_hash = ? WHERE id = ?', [prevHash, entryHash, entity.id])
        entity.prevHash = prevHash
        entity.entryHash = entryHash
        entity.seq = seq
      } catch (error) {
        console.error('[LogService] 审计哈希链封印失败（该行将保持未封印状态）:', error)
      }
    })
  }

  /**
   * 校验哈希链完整性：窗口内逐行重算 entry_hash 并核对 prev 链接。
   * - entry_hash 为 NULL 的行（迁移前存量/封印失败）计入 skipped，不参与衔接；
   * - 每行校验两件事：prev_hash 与「上一条已封印行的 entry_hash」衔接、重算哈希与落库值一致；
   * - 断裂后的行只标一条「前置行已断裂」，避免刷屏；不做任何修复。
   */
  async verifyChain(
    limit = 1000,
    tenantId?: number
  ): Promise<{
    checked: number
    skipped: number
    broken: Array<{ id: string; seq: number; issue: string }>
    ok: boolean
  }> {
    const scopedTenant = tenantId ?? TenantContext.filterTenantId()
    const window = Math.min(Math.max(Math.trunc(limit) || 1000, 1), 10_000)
    // 窗口取「最新 N 条」再正序校验：审计关心的是最近写入是否可信，不是最老的存量
    const rawRows = await this.logRepository.query<Array<Record<string, unknown>>>(
      `SELECT id, tenant_id, seq, prev_hash, entry_hash, log_type, operate_type, operate_user_id,
              operate_user_name, ip, status, params, error_msg, create_time
         FROM sys_log
        WHERE (? IS NULL OR tenant_id = ?) AND seq IS NOT NULL
        ORDER BY seq DESC
        LIMIT ${window}`,
      [scopedTenant ?? null, scopedTenant ?? null]
    )
    const rows = [...rawRows].reverse()

    const broken: Array<{ id: string; seq: number; issue: string }> = []
    let checked = 0
    let skipped = 0
    /** 链按租户划分：校验状态（lastEntryHash/seeded/断裂标记）按租户独立维护。
     *  平台视角（tenantId=null）会拿到所有租户的行，不能串成一条链 */
    const state = new Map<number, { lastEntryHash: string | null; seeded: boolean; broken: boolean }>()
    for (const raw of rows) {
      const id = raw['id'] as string
      const seq = Number(raw['seq'])
      const tenantId = Number(raw['tenant_id'])
      const entryHash = (raw['entry_hash'] as string | null) ?? null
      if (!entryHash) {
        skipped++
        continue
      }
      let chain = state.get(tenantId)
      if (!chain) {
        chain = { lastEntryHash: null, seeded: false, broken: false }
        state.set(tenantId, chain)
      }
      if (chain.broken) {
        broken.push({ id, seq, issue: '前置行已断裂（连带）' })
        continue
      }
      const storedPrev = (raw['prev_hash'] as string | null) ?? null
      if (!chain.seeded) {
        // 窗口起点无法校验「与窗口外行的衔接」（prev 指向更早的行），用其自身 prev 作种子；
        // 后续行严格校验衔接 + 重算。内容篡改检测靠重算，不受种子影响
        chain.lastEntryHash = storedPrev
        chain.seeded = true
      } else if (storedPrev !== chain.lastEntryHash) {
        broken.push({ id, seq, issue: 'prev_hash 与上一条封印行不衔接（插行/删行）' })
        chain.broken = true
        continue
      }
      const row: AuditChainRow = {
        seq,
        tenantId,
        id,
        logType: Number(raw['log_type']),
        operateType: raw['operate_type'] === null || raw['operate_type'] === undefined ? null : Number(raw['operate_type']),
        operateUserId: (raw['operate_user_id'] as string | null) ?? null,
        operateUserName: (raw['operate_user_name'] as string | null) ?? null,
        ip: (raw['ip'] as string) ?? '',
        status: Number(raw['status']),
        params: (raw['params'] as string | null) ?? null,
        errorMsg: (raw['error_msg'] as string | null) ?? null,
        createTimeMs: new Date(raw['create_time'] as Date).getTime()
      }
      const recomputed = computeEntryHash(storedPrev, row)
      if (recomputed !== entryHash) {
        broken.push({ id, seq, issue: 'entry_hash 与重算值不一致（内容被改动）' })
        chain.broken = true
        continue
      }
      checked++
      chain.lastEntryHash = entryHash
    }
    return { checked, skipped, broken, ok: broken.length === 0 }
  }

  /** 记录一次登录尝试（成功或失败）；浏览器/系统/归属地在写入时统一解析，调用方只给 ip + userAgent 原料 */
  async recordLogin(input: LoginLogInput): Promise<void> {
    try {
      // trust proxy 开启后 IPv4 可能以 ::ffff: 前缀（IPv4-mapped IPv6）落库，统一清洗成纯 IPv4
      const ip = input.ip.replace(/^::ffff:/, '')
      const { browser, os, location } = parseRequestInfo(ip, input.userAgent)
      const tenantId = await this.resolveLoginTenant(input.userId, input.tenantId)
      const entity = this.logRepository.create({
        id: randomId32(),
        tenantId,
        logContent: input.message,
        logType: 0,
        operateUserId: input.userId,
        operateUserName: input.username,
        ip,
        status: input.status,
        browser,
        os,
        location,
        createBy: input.username,
        createTime: new Date()
      })
      await this.insertSealed(entity)
    } catch (error) {
      console.error('[LogService] 登录日志写入失败:', error)
    }
  }

  /**
   * 登录日志的归属租户
   *
   * 登录请求没有 token，中间件给的上下文是租户 0，不能直接用。
   * 口径：优先调用方显式传入 → 用户上次选择的租户 → 用户第一个可用租户 → 默认租户。
   * 都要不到（账号不存在）就落默认租户，平台管理员仍可看到。
   */
  private async resolveLoginTenant(userId?: string, explicit?: number): Promise<number> {
    if (explicit && explicit > 0) return explicit
    if (!userId) return DEFAULT_TENANT_ID
    try {
      const rows: Array<{ tenantId: number | string | null }> = await this.logRepository.manager.query(
        `SELECT COALESCE(
                  u.login_tenant_id,
                  (SELECT ut.tenant_id FROM sys_user_tenant ut WHERE ut.user_id = u.id AND ut.status = 0 ORDER BY ut.id LIMIT 1),
                  ?) AS tenantId
           FROM sys_user u WHERE u.id = ?`,
        [DEFAULT_TENANT_ID, userId]
      )
      const resolved = Number(rows[0]?.tenantId ?? DEFAULT_TENANT_ID)
      return resolved > 0 ? resolved : DEFAULT_TENANT_ID
    } catch {
      return DEFAULT_TENANT_ID
    }
  }

  /** 记录一次写操作；log_content 记「模块 - 动作」
   *
   * 代维标记自动推导：平台管理员切在具体租户里（TenantContext.isProxy()）→ is_proxy=1；
   * 调用方显式传入 isProxy 时以传入值为准（如平台视角审计的 GET 记录）。
   */
  async recordOper(input: OperLogInput): Promise<void> {
    try {
      const entity = this.logRepository.create({
        id: randomId32(),
        tenantId: input.tenantId ?? TenantContext.currentTenantId() ?? 0,
        isProxy: input.isProxy ?? (TenantContext.isProxy() ? 1 : 0),
        logContent: `${input.module} - ${input.action}`.slice(0, 1000),
        logType: 1,
        operateType: input.operateType,
        operateUserId: input.userId,
        operateUserName: input.username ?? '未知',
        ip: input.ip.replace(/^::ffff:/, ''),
        status: input.status,
        costTime: input.elapsed,
        params: input.params,
        errorMsg: input.errorMsg,
        createBy: input.username,
        createTime: new Date()
      })
      await this.insertSealed(entity)
    } catch (error) {
      console.error('[LogService] 操作日志写入失败:', error)
    }
  }

  /**
   * 把当前请求的租户条件并进日志查询
   *
   * 与其它表**不同**：这里不用「tenant_id = 0 是共享数据」的通用语义。
   * 审计可见性 != 数据共享 —— 平台级操作（tenant_id=0）只给平台管理员看，
   * 租户查询用严格相等，绝不 OR 0，否则平台管理员的运维记录会漏进每个租户的审计列表。
   * 没有租户归属（tenantId=0）的账号一条都看不到（1 = 0）。
   */
  private applyLogTenantScope(qb: SelectQueryBuilder<SysLogEntity>): SelectQueryBuilder<SysLogEntity> {
    const tenantId = TenantContext.filterTenantId()
    if (tenantId === null) return qb
    if (tenantId === 0) {
      qb.andWhere('1 = 0')
      return qb
    }
    qb.andWhere('log.tenant_id = :logTenantId', { logTenantId: tenantId })
    return qb
  }

  /** 登录日志查询条件构造（列表与导出共用，log_type=0） */
  private buildLoginLogQb(query: {
    userId?: string
    username?: string
    status?: number
    startTime?: string
    endTime?: string
    sortBy?: string
    sortOrder?: 'asc' | 'desc'
  }) {
    const qb = this.logRepository
      .createQueryBuilder('log')
      .where('log.log_type = :logType', { logType: 0 })
      .orderBy('log.create_time', 'DESC')
      .addOrderBy('log.id', 'DESC')
    this.applyLogTenantScope(qb)
    applySort(qb, 'log', query, LOG_SORTABLE)
    // 精确按用户过滤（用户管理页「登录日志」弹窗用）：优先 userId，改名不影响历史归属
    if (query.userId) {
      qb.andWhere('log.operate_user_id = :userId', { userId: query.userId })
    }
    if (query.username) {
      qb.andWhere('log.operate_user_name LIKE :username', { username: `%${query.username}%` })
    }
    if (query.status !== undefined) {
      qb.andWhere('log.status = :status', { status: query.status })
    }
    if (query.startTime) {
      qb.andWhere('log.create_time >= :startTime', { startTime: query.startTime })
    }
    if (query.endTime) {
      qb.andWhere('log.create_time <= :endTime', { endTime: query.endTime })
    }
    return qb
  }

  /** 操作日志查询条件构造（列表与导出共用，log_type=1） */
  private buildOperLogQb(query: { username?: string; module?: string; startTime?: string; endTime?: string; sortBy?: string; sortOrder?: 'asc' | 'desc' }) {
    const qb = this.logRepository
      .createQueryBuilder('log')
      .where('log.log_type = :logType', { logType: 1 })
      .orderBy('log.create_time', 'DESC')
      .addOrderBy('log.id', 'DESC')
    this.applyLogTenantScope(qb)
    applySort(qb, 'log', query, LOG_SORTABLE)
    if (query.username) {
      qb.andWhere('log.operate_user_name LIKE :username', { username: `%${query.username}%` })
    }
    if (query.module) {
      qb.andWhere('log.log_content LIKE :module', { module: `%${query.module}%` })
    }
    if (query.startTime) {
      qb.andWhere('log.create_time >= :startTime', { startTime: query.startTime })
    }
    if (query.endTime) {
      qb.andWhere('log.create_time <= :endTime', { endTime: query.endTime })
    }
    return qb
  }

  /** 分页查询登录日志，支持用户名/结果/时间范围过滤 */
  async listLoginLog(query: {
    page?: number
    pageSize?: number
    userId?: string
    username?: string
    status?: number
    startTime?: string
    endTime?: string
  }): Promise<Pagination<SysLogEntity>> {
    return paginate(this.buildLoginLogQb(query), { page: query.page, pageSize: query.pageSize })
  }

  /** 分页查询操作日志，支持模块/操作人/时间范围过滤 */
  async listOperLog(query: {
    page?: number
    pageSize?: number
    username?: string
    module?: string
    startTime?: string
    endTime?: string
  }): Promise<Pagination<SysLogEntity>> {
    return paginate(this.buildOperLogQb(query), { page: query.page, pageSize: query.pageSize })
  }

  /** 导出登录日志（与列表同过滤条件，不分页，上限 5 万行防拖库） */
  async exportLoginLog(query: { userId?: string; username?: string; status?: number; startTime?: string; endTime?: string }): Promise<SysLogEntity[]> {
    return this.buildLoginLogQb(query).take(50000).getMany()
  }

  /** 导出操作日志（与列表同过滤条件，不分页，上限 5 万行防拖库） */
  async exportOperLog(query: { username?: string; module?: string; startTime?: string; endTime?: string }): Promise<SysLogEntity[]> {
    return this.buildOperLogQb(query).take(50000).getMany()
  }

  /** 登录日志详情，不存在抛 404（跨租户同样视为不存在，不泄漏存在性） */
  async findLoginLog(id: string): Promise<SysLogEntity> {
    const qb = this.logRepository.createQueryBuilder('log').where('log.id = :id', { id }).andWhere('log.log_type = :logType', { logType: 0 })
    this.applyLogTenantScope(qb)
    const log = await qb.getOne()
    if (!log) {
      throw new NotFoundException('登录日志不存在')
    }
    return log
  }

  /** 操作日志详情，不存在抛 404 */
  async findOperLog(id: string): Promise<SysLogEntity> {
    const qb = this.logRepository.createQueryBuilder('log').where('log.id = :id', { id }).andWhere('log.log_type = :logType', { logType: 1 })
    this.applyLogTenantScope(qb)
    const log = await qb.getOne()
    if (!log) {
      throw new NotFoundException('操作日志不存在')
    }
    return log
  }

  /** 批量删除登录日志，返回删除条数（带租户条件，避免构造 id 跨租户删除） */
  async removeLoginLogs(ids: string[]): Promise<{ deleted: number }> {
    const qb = this.logRepository.createQueryBuilder().delete().where('id IN (:...ids)', { ids }).andWhere('log_type = :logType', { logType: 0 })
    return { deleted: (await this.applyDeleteTenantScope(qb).execute()).affected ?? 0 }
  }

  /** 批量删除操作日志，返回删除条数 */
  async removeOperLogs(ids: string[]): Promise<{ deleted: number }> {
    const qb = this.logRepository.createQueryBuilder().delete().where('id IN (:...ids)', { ids }).andWhere('log_type = :logType', { logType: 1 })
    return { deleted: (await this.applyDeleteTenantScope(qb).execute()).affected ?? 0 }
  }

  /** DELETE 语句没有别名，租户列直接写 tenant_id（与 tenantRawCondition 同语义，但不含 0 共享） */
  private applyDeleteTenantScope(qb: DeleteQueryBuilder<SysLogEntity>): DeleteQueryBuilder<SysLogEntity> {
    const tenantId = TenantContext.filterTenantId()
    if (tenantId === null) return qb
    if (tenantId === 0) {
      qb.andWhere('1 = 0')
      return qb
    }
    qb.andWhere('tenant_id = :logTenantId', { logTenantId: tenantId })
    return qb
  }

  /**
   * 导入登录日志（log_type=0）
   *
   * 列映射与模板表头一致：用户名 / 结果 / 说明 / IP / 浏览器 / 操作系统 / 登录时间。
   * 单行失败不影响其他行，返回结构与用户导入完全相同，前端结果面板可直接复用。
   */
  async importLoginLogs(rows: string[][], headerRowNumber = 1, operator?: string): Promise<ImportResult> {
    return this.importLogRows(rows, headerRowNumber, operator, 0, LOGIN_IMPORT_ALIASES, (get, statusOf) => {
      const createTime = parseLogTime(get('time'))
      if (get('time') && !createTime) {
        return `登录时间「${get('time')}」格式不对，请用 2026-11-06 19:00:00`
      }
      return {
        username: get('username'),
        status: statusOf(get('status')) ?? 0,
        content: get('content') || '导入的登录记录',
        ip: get('ip') || '0.0.0.0',
        browser: get('browser') || undefined,
        os: get('os') || undefined,
        createTime: createTime ?? new Date()
      }
    })
  }

  /**
   * 导入操作日志（log_type=1）
   *
   * 列映射：操作人 / 模块 / 操作 / 结果 / 耗时(ms) / IP / 操作时间。
   * log_content 按约定拼成「模块 - 操作」。
   */
  async importOperLogs(rows: string[][], headerRowNumber = 1, operator?: string): Promise<ImportResult> {
    return this.importLogRows(rows, headerRowNumber, operator, 1, OPER_IMPORT_ALIASES, (get, statusOf) => {
      const createTime = parseLogTime(get('time'))
      if (get('time') && !createTime) {
        return `操作时间「${get('time')}」格式不对，请用 2026-11-06 19:00:00`
      }
      const costText = get('cost')
      if (costText && !/^\d+$/.test(costText)) {
        return `耗时「${costText}」必须是正整数（毫秒）`
      }
      const module = get('module')
      const action = get('action')
      return {
        username: get('username'),
        status: statusOf(get('status')) ?? 0,
        content: action ? `${module} - ${action}` : module,
        ip: get('ip') || '0.0.0.0',
        cost: costText ? Number(costText) : undefined,
        createTime: createTime ?? new Date()
      }
    })
  }

  /**
   * 导入公共流程：定位列 → 逐行解析 → 批量落库
   *
   * 两种日志只差列别名与行解析规则，其余（表头缺失报错、行数上限、错误收集、分批写入）完全一致。
   */
  private async importLogRows(
    rows: string[][],
    headerRowNumber: number,
    operator: string | undefined,
    logType: 0 | 1,
    aliases: Partial<Record<LogImportField, string[]>>,
    parseRow: (get: (field: LogImportField) => string, statusOf: (text: string) => number | undefined) => ImportedLogRow | string
  ): Promise<ImportResult> {
    const { columns, dataRows } = resolveImportLayout(rows, headerRowNumber, aliases as Record<LogImportField, string[]>)
    if (columns.username === undefined) {
      throw new BizException(BizErrorCode.IMPORT_HEADER_MISMATCH, '未找到「用户名」列，请使用导入模板的表头', HttpStatus.BAD_REQUEST)
    }
    assertImportRows(dataRows)

    const result = createImportResult(dataRows.length)
    const entities: SysLogEntity[] = []
    // 导入的日志归属当前租户（平台视角导入落平台级 0，仅平台管理员可见）
    const importTenantId = TenantContext.filterTenantId() ?? 0

    for (const { rowNumber, cells } of dataRows) {
      const username = pickCell(columns, cells, 'username')
      if (!username) {
        failImportRow(result, rowNumber, '用户名为空')
        continue
      }
      const parsed = parseRow(field => pickCell(columns, cells, field), parseLogStatus)
      if (typeof parsed === 'string') {
        failImportRow(result, rowNumber, parsed, username)
        continue
      }
      entities.push(
        this.logRepository.create({
          id: randomId32(),
          tenantId: importTenantId,
          logType,
          operateUserName: parsed.username,
          logContent: String(parsed.content ?? '').slice(0, 1000),
          ip: parsed.ip.replace(/^::ffff:/, ''),
          status: parsed.status ?? 0,
          browser: parsed.browser,
          os: parsed.os,
          costTime: parsed.cost,
          createBy: operator ?? parsed.username,
          createTime: parsed.createTime
        })
      )
    }

    // 分批写入：2000 行一条 SQL 参数太多容易超包大小，500 一批稳妥
    for (let start = 0; start < entities.length; start += 500) {
      await this.logRepository.save(entities.slice(start, start + 500))
    }
    result.created = entities.length
    return result
  }
}

/** 日志导入可识别的列 */
type LogImportField = 'username' | 'status' | 'content' | 'ip' | 'browser' | 'os' | 'module' | 'action' | 'cost' | 'time'

/** 导入过程中解析出的一行（尚未落库） */
interface ImportedLogRow {
  username: string
  status?: number
  content?: string
  ip: string
  browser?: string
  os?: string
  cost?: number
  createTime: Date
}

/** 登录日志导入列别名：同一列允许几种叫法，兼容手改表头 */
const LOGIN_IMPORT_ALIASES: Record<'username' | 'status' | 'content' | 'ip' | 'browser' | 'os' | 'time', string[]> = {
  username: ['用户名', '登录账号', '账号', 'operateusername', 'username'],
  status: ['结果', '状态', 'status'],
  content: ['说明', '日志内容', '描述', 'logcontent'],
  ip: ['ip', 'ip地址'],
  browser: ['浏览器', 'browser'],
  os: ['操作系统', '系统', 'os'],
  time: ['登录时间', '时间', 'createtime']
}

/** 操作日志导入列别名 */
const OPER_IMPORT_ALIASES: Record<'username' | 'status' | 'module' | 'action' | 'cost' | 'ip' | 'time', string[]> = {
  username: ['操作人', '用户名', '登录账号', 'operateusername'],
  status: ['结果', '状态', 'status'],
  module: ['模块', '模块名', 'module'],
  action: ['操作', '动作', 'action'],
  cost: ['耗时', '耗时(ms)', 'costtime'],
  ip: ['ip', 'ip地址'],
  time: ['操作时间', '时间', 'createtime']
}

/** 结果文本归一：成功/正常/0 → 0，失败/异常/1 → 1；其他返回 undefined（交给调用方报错） */
function parseLogStatus(text: string): number | undefined {
  const value = text.trim().toLowerCase()
  if (!value) {
    return undefined
  }
  if (['0', '成功', '正常', 'ok', 'success'].includes(value)) {
    return 0
  }
  if (['1', '失败', '异常', 'fail', 'failed'].includes(value)) {
    return 1
  }
  return undefined
}

/** 时间解析：支持 2026-11-06 19:00:00、2026/11/06 19:00、ISO 8601；解析不出返回 undefined */
function parseLogTime(text: string): Date | undefined {
  const value = text.trim()
  if (!value) {
    return undefined
  }
  const normalized = value.replace(/\//g, '-')
  const date = new Date(normalized.includes('T') ? normalized : normalized.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? undefined : date
}
