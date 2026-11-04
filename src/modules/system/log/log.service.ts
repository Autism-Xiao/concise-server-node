import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'

import { paginate, type Pagination } from '../../../helper/paginate'
import { parseRequestInfo } from '../../../utils/request-info.util'
import { LoginLogEntity } from './entities/login-log.entity'
import { OperLogEntity } from './entities/oper-log.entity'

export interface LoginLogInput {
  username: string
  status: number
  message: string
  ip: string
  userAgent?: string
}

export interface OperLogInput {
  userId?: string
  username?: string
  module: string
  action: string
  ip: string
  params?: string
  status: number
  errorMsg?: string
  elapsed: number
}

/**
 * 日志服务：登录日志 + 操作日志的写入与查询
 * 写入失败只打日志不上抛——日志永远不能影响业务主流程
 */
@Injectable()
export class LogService {
  constructor(
    @InjectRepository(LoginLogEntity)
    private readonly loginLogRepository: Repository<LoginLogEntity>,
    @InjectRepository(OperLogEntity)
    private readonly operLogRepository: Repository<OperLogEntity>
  ) {}

  /** 记录一次登录尝试（成功或失败）；浏览器/系统/归属地在写入时统一解析，调用方只给 ip + userAgent 原料 */
  async recordLogin(input: LoginLogInput): Promise<void> {
    try {
      // trust proxy 开启后 IPv4 可能以 ::ffff: 前缀（IPv4-mapped IPv6）落库，统一清洗成纯 IPv4
      const ip = input.ip.replace(/^::ffff:/, '')
      const { browser, os, location } = parseRequestInfo(ip, input.userAgent)
      await this.loginLogRepository.save(this.loginLogRepository.create({ ...input, ip, browser, os, location }))
    } catch (error) {
      console.error('[LogService] 登录日志写入失败:', error)
    }
  }

  /** 记录一次写操作 */
  async recordOper(input: OperLogInput): Promise<void> {
    try {
      await this.operLogRepository.save(this.operLogRepository.create(input))
    } catch (error) {
      console.error('[LogService] 操作日志写入失败:', error)
    }
  }

  /** 登录日志查询条件构造（列表与导出共用） */
  private buildLoginLogQb(query: { username?: string; status?: number; startTime?: string; endTime?: string }) {
    const qb = this.loginLogRepository.createQueryBuilder('log').orderBy('log.id', 'DESC')
    if (query.username) {
      qb.andWhere('log.username LIKE :username', { username: `%${query.username}%` })
    }
    if (query.status !== undefined) {
      qb.andWhere('log.status = :status', { status: query.status })
    }
    if (query.startTime) {
      qb.andWhere('log.createdAt >= :startTime', { startTime: query.startTime })
    }
    if (query.endTime) {
      qb.andWhere('log.createdAt <= :endTime', { endTime: query.endTime })
    }
    return qb
  }

  /** 操作日志查询条件构造（列表与导出共用） */
  private buildOperLogQb(query: { username?: string; module?: string; startTime?: string; endTime?: string }) {
    const qb = this.operLogRepository.createQueryBuilder('log').orderBy('log.id', 'DESC')
    if (query.username) {
      qb.andWhere('log.username LIKE :username', { username: `%${query.username}%` })
    }
    if (query.module) {
      qb.andWhere('log.module LIKE :module', { module: `%${query.module}%` })
    }
    if (query.startTime) {
      qb.andWhere('log.createdAt >= :startTime', { startTime: query.startTime })
    }
    if (query.endTime) {
      qb.andWhere('log.createdAt <= :endTime', { endTime: query.endTime })
    }
    return qb
  }

  /** 分页查询登录日志，支持用户名/结果/时间范围过滤 */
  async listLoginLog(query: {
    page?: number
    pageSize?: number
    username?: string
    status?: number
    startTime?: string
    endTime?: string
  }): Promise<Pagination<LoginLogEntity>> {
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
  }): Promise<Pagination<OperLogEntity>> {
    return paginate(this.buildOperLogQb(query), { page: query.page, pageSize: query.pageSize })
  }

  /** 导出登录日志（与列表同过滤条件，不分页，上限 5 万行防拖库） */
  async exportLoginLog(query: { username?: string; status?: number; startTime?: string; endTime?: string }): Promise<LoginLogEntity[]> {
    return this.buildLoginLogQb(query).take(50000).getMany()
  }

  /** 导出操作日志（与列表同过滤条件，不分页，上限 5 万行防拖库） */
  async exportOperLog(query: { username?: string; module?: string; startTime?: string; endTime?: string }): Promise<OperLogEntity[]> {
    return this.buildOperLogQb(query).take(50000).getMany()
  }

  /** 登录日志详情，不存在抛 404 */
  async findLoginLog(id: number): Promise<LoginLogEntity> {
    const log = await this.loginLogRepository.findOne({ where: { id } })
    if (!log) {
      throw new NotFoundException('登录日志不存在')
    }
    return log
  }

  /** 操作日志详情，不存在抛 404 */
  async findOperLog(id: number): Promise<OperLogEntity> {
    const log = await this.operLogRepository.findOne({ where: { id } })
    if (!log) {
      throw new NotFoundException('操作日志不存在')
    }
    return log
  }

  /** 批量删除登录日志，返回删除条数 */
  async removeLoginLogs(ids: number[]): Promise<{ deleted: number }> {
    const result = await this.loginLogRepository.delete({ id: In(ids) })
    return { deleted: result.affected ?? 0 }
  }

  /** 批量删除操作日志，返回删除条数 */
  async removeOperLogs(ids: number[]): Promise<{ deleted: number }> {
    const result = await this.operLogRepository.delete({ id: In(ids) })
    return { deleted: result.affected ?? 0 }
  }
}
