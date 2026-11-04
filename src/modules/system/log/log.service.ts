import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'

import { paginate, type Pagination } from '../../../helper/paginate'
import { randomId32 } from '../../../utils/password.util'
import { parseRequestInfo } from '../../../utils/request-info.util'
import { SysLogEntity } from './entities/sys-log.entity'

/** 登录日志入参（status 为 jeecg 语义：0 成功 / 1 失败） */
export interface LoginLogInput {
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
  private buildLoginLogQb(query: { username?: string; status?: number; startTime?: string; endTime?: string }) {
    const qb = this.logRepository
      .createQueryBuilder('log')
      .where('log.log_type = :logType', { logType: 0 })
      .orderBy('log.create_time', 'DESC')
      .addOrderBy('log.id', 'DESC')
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
  async exportLoginLog(query: { username?: string; status?: number; startTime?: string; endTime?: string }): Promise<SysLogEntity[]> {
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
}
