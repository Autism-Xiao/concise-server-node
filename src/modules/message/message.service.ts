import { BadRequestException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, Repository } from 'typeorm'

import { BizErrorCode } from '../../common/enums/biz-error-code.enum'
import { BizException } from '../../common/exceptions/biz.exception'
import { applySort, paginate, Pagination, type Pagination as PaginationType } from '../../helper/paginate'
import { RealtimeService, WS_EVENTS, type MessageNewPayload } from '../../shared/realtime/realtime.service'
import { applyTenantScope, SHARED_TENANT_ID, tenantWriteCondition } from '../../shared/tenant/tenant-scope.util'
import { TenantContext } from '../../shared/tenant/tenant.context'
import { SysMessageEntity } from './entities/sys-message.entity'
import { SysMessageUserEntity } from './entities/sys-message-user.entity'
import type { QueryMessageDto, QueryMyMessageDto, SendMessageDto } from './dto/message.dto'

/** 我的消息列表单行 */
export interface MyMessageRow {
  id: string
  title: string
  content: string
  msgType: string
  senderId: string | null
  isRead: number
  readAt: Date | null
  createdAt: Date
}

/** 可排序字段白名单：前端列 id → 实体属性名 */
const MESSAGE_SORTABLE: Record<string, string> = {
  title: 'title',
  msgType: 'msgType',
  receiverCount: 'receiverCount',
  createdAt: 'createdAt'
}

/**
 * 站内信服务
 *
 * 数据模型：sys_message（一份内容）+ sys_message_user（一人一行，已读状态挂关联表）。
 * 为什么不把已读放消息表上：一条消息 N 个接收人各自独立已读，只能在关联表上记。
 *
 * 多实例/重试安全：UNIQUE(message_id, user_id) 兜底，重复投递不产生双份未读。
 */
@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name)

  constructor(
    @InjectRepository(SysMessageEntity) private readonly messageRepo: Repository<SysMessageEntity>,
    @InjectRepository(SysMessageUserEntity) private readonly messageUserRepo: Repository<SysMessageUserEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly realtime: RealtimeService
  ) {}

  /** 发送站内信（管理端）：接收人支持用户 ID 或用户名混填，过滤到真实存在的账号，返回实际送达数 */
  async send(dto: SendMessageDto, senderId?: string): Promise<{ id: string; delivered: number }> {
    const entries = [...new Set(dto.userIds.map(item => item.trim()).filter(Boolean))]
    if (entries.length === 0) {
      throw new BadRequestException('接收人不能为空')
    }
    // 每个条目既可能是 ID 也可能是用户名，一并查出后按入参位置对回真实 ID。
    // 接收人必须落在**当前租户**内：站内信是租户资产，能按 id/用户名直接给别家租户的用户发信
    // 等于开了一条跨租户骚扰/钓鱼通道（发送方列表看不到对方，对方收件箱里却会出现这条消息）。
    // 平台视角（null）不加限制 —— 平台管理员给指定租户的用户发通知是正常业务。
    const scopeTenantId = TenantContext.filterTenantId()
    let tenantClause = ''
    const queryParams: Array<string | number> = [...entries, ...entries]
    if (scopeTenantId === SHARED_TENANT_ID) {
      // 没有租户归属的账号只发给平台账号（没有任何租户成员关系的人）
      tenantClause = ' AND NOT EXISTS (SELECT 1 FROM sys_user_tenant ut WHERE ut.user_id = u.id)'
    } else if (scopeTenantId !== null) {
      tenantClause = ' AND EXISTS (SELECT 1 FROM sys_user_tenant ut WHERE ut.user_id = u.id AND ut.tenant_id = ? AND ut.status = 0)'
      queryParams.push(scopeTenantId)
    }
    const placeholders = entries.map(() => '?').join(',')
    const existings = await this.dataSource.query<Array<{ id: string; username: string }>>(
      `SELECT u.id, u.username FROM sys_user u WHERE (u.id IN (${placeholders}) OR u.username IN (${placeholders})) AND u.del_flag = 0${tenantClause}`,
      queryParams
    )
    const byKey = new Map<string, string>()
    for (const row of existings) {
      byKey.set(row.id, row.id)
      byKey.set(row.username, row.id)
    }
    const missing = entries.filter(entry => !byKey.has(entry))
    if (missing.length > 0) {
      throw new BizException(BizErrorCode.MESSAGE_RECEIVER_INVALID, `以下接收人不存在或已删除：${missing.join('、')}`, HttpStatus.BAD_REQUEST)
    }
    const validIds = [...new Set(entries.map(entry => byKey.get(entry) as string))]
    if (validIds.length === 0) {
      throw new BizException(BizErrorCode.MESSAGE_RECEIVER_INVALID, '接收人不存在或已删除', HttpStatus.BAD_REQUEST)
    }

    // 多步写必须事务；事务内一律 manager.getRepository()（默认连接看不到未提交数据）
    return this.dataSource.transaction(async manager => {
      const message = await manager.getRepository(SysMessageEntity).save({
        title: dto.title,
        content: dto.content,
        msgType: dto.msgType ?? 'send',
        senderId: senderId ?? null,
        // 平台视角（筛选上下文 null）落 tenant_id=0 = 平台共享，所有租户的接收人可见；
        // 以前写 `?? 1` 会把平台公告错归到 1 号租户，既广播不出去又污染该租户收件箱
        tenantId: TenantContext.filterTenantId() ?? SHARED_TENANT_ID,
        receiverCount: validIds.length
      })
      // 分批插入关联行：500 一批防超参；orIgnore 对重复 (message_id, user_id) 幂等
      for (let i = 0; i < validIds.length; i += 500) {
        await manager
          .createQueryBuilder()
          .insert()
          .into(SysMessageUserEntity)
          .values(
            validIds.slice(i, i + 500).map(userId => ({
              messageId: message.id,
              userId,
              isRead: 0
            }))
          )
          .orIgnore()
          .execute()
      }
      this.logger.log(`站内信已发送：title=${dto.title} 送达 ${validIds.length} 人`)
      // 实时推送：在线的接收人立刻收到红点，不在线的靠前端轮询兜底
      const payload: MessageNewPayload = {
        id: message.id,
        title: message.title,
        content: message.content,
        msgType: message.msgType,
        createdAt: message.createdAt.toISOString?.() ?? String(message.createdAt)
      }
      this.realtime.pushToUsers(validIds, WS_EVENTS.messageNew, payload)
      return { id: message.id, delivered: validIds.length }
    })
  }

  /** 程序化通知入口（定时任务、系统事件用）：不走 @Perms，直接投递 */
  async notify(title: string, content: string, userIds: string[], msgType = 'system'): Promise<number> {
    if (userIds.length === 0) return 0
    const result = await this.send({ title, content, msgType, userIds })
    return result.delivered
  }

  /** 发送记录分页（管理端） */
  async list(query: QueryMessageDto): Promise<PaginationType<SysMessageEntity>> {
    const qb = this.messageRepo.createQueryBuilder('m').orderBy('m.createdAt', 'DESC').addOrderBy('m.id', 'DESC')
    applyTenantScope(qb, 'm')
    applySort(qb, 'm', query, MESSAGE_SORTABLE)
    if (query.keyword) {
      qb.andWhere('m.title LIKE :keyword', { keyword: `%${query.keyword}%` })
    }
    if (query.msgType) {
      qb.andWhere('m.msgType = :msgType', { msgType: query.msgType })
    }
    return paginate(qb, { page: query.page, pageSize: query.pageSize })
  }

  /**
   * 删除发送记录（管理端）：连同接收人关联一起删
   *
   * 删除必须带**写租户条件**（严格本租户，不含 tenant_id=0 的平台共享消息）：
   * 之前只按 id 删，租户管理员拿到别家的 messageId 就能把对方的发送记录连同
   * 接收人关联一起清掉（实测可复现）。
   */
  async remove(id: string): Promise<void> {
    await this.dataSource.transaction(async manager => {
      const qb = manager.getRepository(SysMessageEntity).createQueryBuilder().delete().from(SysMessageEntity).where('id = :id', { id })
      const writeCondition = tenantWriteCondition()
      if (writeCondition) {
        qb.andWhere(writeCondition.clause, writeCondition.params)
      }
      const affected = (await qb.execute()).affected ?? 0
      if (affected === 0) {
        // 不在可见范围与不存在同样处理，不泄漏「这条消息存在但不属于你」
        throw new NotFoundException('消息不存在')
      }
      await manager.getRepository(SysMessageUserEntity).delete({ messageId: id })
    })
  }

  /** 我的消息分页（登录用户；raw 投影 + 手动 count） */
  async mine(userId: string, query: QueryMyMessageDto): Promise<PaginationType<MyMessageRow>> {
    const unread = query.unread === undefined ? undefined : Number(query.unread)
    const page = Math.max(query.page ?? 1, 1)
    const pageSize = Math.max(query.pageSize ?? 10, 1)
    // 「我的消息」按收件人查，但消息本体是租户资产：同一用户在 A、B 两个租户各有各的收件箱，
    // 不加这个条件会把 B 租户发给他的消息也列出来（tenant_id=0 是平台公告，所有租户可见）
    const tenantJoin = this.messageTenantJoin()

    const listQb = this.messageUserRepo
      .createQueryBuilder('mu')
      .innerJoin(SysMessageEntity, 'm', `m.id = mu.messageId${tenantJoin.clause}`)
      .select([
        'm.id AS id',
        'm.title AS title',
        'm.content AS content',
        'm.msgType AS msgType',
        'm.senderId AS senderId',
        'mu.isRead AS isRead',
        'mu.readAt AS readAt',
        'mu.createdAt AS createdAt'
      ])
      .where('mu.userId = :userId', { userId })
      .orderBy('mu.createdAt', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize)
    if (tenantJoin.params) listQb.setParameters(tenantJoin.params)
    const countQb = this.messageUserRepo
      .createQueryBuilder('mu')
      .innerJoin(SysMessageEntity, 'm', `m.id = mu.messageId${tenantJoin.clause}`)
      .where('mu.userId = :userId', { userId })
    if (tenantJoin.params) countQb.setParameters(tenantJoin.params)
    if (unread === 1) {
      listQb.andWhere('mu.isRead = 0')
      countQb.andWhere('mu.isRead = 0')
    }
    const [records, total] = await Promise.all([listQb.getRawMany<MyMessageRow>(), countQb.getCount()])
    return new Pagination(records, total, page, pageSize)
  }

  /** 未读数（顶栏红点）：同样按租户收窄，口径与 mine 一致 */
  async unreadCount(userId: string): Promise<number> {
    const tenantJoin = this.messageTenantJoin()
    const qb = this.messageUserRepo
      .createQueryBuilder('mu')
      .innerJoin(SysMessageEntity, 'm', `m.id = mu.messageId${tenantJoin.clause}`)
      .where('mu.userId = :userId', { userId })
      .andWhere('mu.isRead = 0')
    if (tenantJoin.params) qb.setParameters(tenantJoin.params)
    return qb.getCount()
  }

  /**
   * 「我的消息」的租户 join 条件片段
   *
   * 平台视角（null）不加条件；租户视角只放本租户 + 平台公告（tenant_id=0）；
   * 没有租户归属（0）只看平台公告。
   */
  private messageTenantJoin(): { clause: string; params?: Record<string, number> } {
    const tenantId = TenantContext.filterTenantId()
    if (tenantId === null) return { clause: '' }
    if (tenantId === 0) return { clause: ' AND m.tenant_id = 0' }
    return { clause: ' AND (m.tenant_id = :msgTenantId OR m.tenant_id = 0)', params: { msgTenantId: tenantId } }
  }

  /** 标记单条已读 */
  async markRead(userId: string, messageId: string): Promise<void> {
    await this.messageUserRepo.update({ userId, messageId }, { isRead: 1, readAt: new Date() })
  }

  /** 全部已读 */
  async markAllRead(userId: string): Promise<void> {
    await this.messageUserRepo.update({ userId, isRead: 0 }, { isRead: 1, readAt: new Date() })
  }

  /** 消息详情（管理端查看接收名单的已读情况） */
  async receivers(id: string): Promise<Array<{ userId: string; isRead: number; readAt: Date | null }>> {
    // 先按读范围确认这条消息对当前租户可见：sys_message_user 上没有租户列，
    // 只按 messageId 查等于把任意租户的接收名单（含已读状态）暴露出去
    const visibleQb = this.messageRepo.createQueryBuilder('m').where('m.id = :id', { id })
    applyTenantScope(visibleQb, 'm')
    const message = await visibleQb.getOne()
    if (!message) {
      throw new NotFoundException('消息不存在')
    }
    const rows = await this.messageUserRepo.find({
      where: { messageId: id },
      select: { userId: true, isRead: true, readAt: true }
    })
    return rows.map(row => ({ userId: row.userId, isRead: row.isRead, readAt: row.readAt ?? null }))
  }
}
