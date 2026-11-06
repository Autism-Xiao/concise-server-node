import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'

import { assertImportRows, createImportResult, failImportRow, type ImportResult, pickCell, resolveImportLayout } from '../../../helper/import/excel-import'
import { paginate, type Pagination } from '../../../helper/paginate'
import { randomId32 } from '../../../utils/password.util'
import { parseRequestInfo } from '../../../utils/request-info.util'
import { SysLogEntity } from './entities/sys-log.entity'

/** 登录日志入参（status 为 jeecg 语义：0 成功 / 1 失败） */
export interface LoginLogInput {
  /** 账号校验通过后的用户 ID（用于按人检索登录日志）；账号不存在时为空 */
  userId?: string
  username: string
  status: number
  message: string
  ip: string
  userAgent?: string
}

/** 操作日志入参（status 为 jeecg 语义：0 成功 / 1 失败） */
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
}

/**
 * 日志服务（单表 sys_log，对齐 JeecgBoot）：
 * 登录日志 log_type=0、操作日志 log_type=1 共用一张表；
 * status 为 jeecg 语义 0 正常（成功）/ 1 异常（失败）。
 * 写入失败只打日志不上抛——日志永远不能影响业务主流程
 */
@Injectable()
export class LogService {
  constructor(
    @InjectRepository(SysLogEntity)
    private readonly logRepository: Repository<SysLogEntity>
  ) {}

  /** 记录一次登录尝试（成功或失败）；浏览器/系统/归属地在写入时统一解析，调用方只给 ip + userAgent 原料 */
  async recordLogin(input: LoginLogInput): Promise<void> {
    try {
      // trust proxy 开启后 IPv4 可能以 ::ffff: 前缀（IPv4-mapped IPv6）落库，统一清洗成纯 IPv4
      const ip = input.ip.replace(/^::ffff:/, '')
      const { browser, os, location } = parseRequestInfo(ip, input.userAgent)
      await this.logRepository.save(
        this.logRepository.create({
          id: randomId32(),
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
      )
    } catch (error) {
      console.error('[LogService] 登录日志写入失败:', error)
    }
  }

  /** 记录一次写操作；log_content 记「模块 - 动作」 */
  async recordOper(input: OperLogInput): Promise<void> {
    try {
      await this.logRepository.save(
        this.logRepository.create({
          id: randomId32(),
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
      )
    } catch (error) {
      console.error('[LogService] 操作日志写入失败:', error)
    }
  }

  /** 登录日志查询条件构造（列表与导出共用，log_type=0） */
  private buildLoginLogQb(query: { userId?: string; username?: string; status?: number; startTime?: string; endTime?: string }) {
    const qb = this.logRepository
      .createQueryBuilder('log')
      .where('log.log_type = :logType', { logType: 0 })
      .orderBy('log.create_time', 'DESC')
      .addOrderBy('log.id', 'DESC')
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
  private buildOperLogQb(query: { username?: string; module?: string; startTime?: string; endTime?: string }) {
    const qb = this.logRepository
      .createQueryBuilder('log')
      .where('log.log_type = :logType', { logType: 1 })
      .orderBy('log.create_time', 'DESC')
      .addOrderBy('log.id', 'DESC')
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

  /** 登录日志详情，不存在抛 404 */
  async findLoginLog(id: string): Promise<SysLogEntity> {
    const log = await this.logRepository.findOne({ where: { id, logType: 0 } })
    if (!log) {
      throw new NotFoundException('登录日志不存在')
    }
    return log
  }

  /** 操作日志详情，不存在抛 404 */
  async findOperLog(id: string): Promise<SysLogEntity> {
    const log = await this.logRepository.findOne({ where: { id, logType: 1 } })
    if (!log) {
      throw new NotFoundException('操作日志不存在')
    }
    return log
  }

  /** 批量删除登录日志，返回删除条数 */
  async removeLoginLogs(ids: string[]): Promise<{ deleted: number }> {
    const result = await this.logRepository.delete({ id: In(ids), logType: 0 })
    return { deleted: result.affected ?? 0 }
  }

  /** 批量删除操作日志，返回删除条数 */
  async removeOperLogs(ids: string[]): Promise<{ deleted: number }> {
    const result = await this.logRepository.delete({ id: In(ids), logType: 1 })
    return { deleted: result.affected ?? 0 }
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
   * log_content 按 JeecgBoot 约定拼成「模块 - 操作」。
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
      throw new BadRequestException('未找到「用户名」列，请使用导入模板的表头')
    }
    assertImportRows(dataRows)

    const result = createImportResult(dataRows.length)
    const entities: SysLogEntity[] = []

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
