import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, Repository } from 'typeorm'

import { paginate, Pagination, type Pagination as PaginationType } from '../../helper/paginate'
import { RealtimeService, WS_EVENTS, type MessageNewPayload } from '../../shared/realtime/realtime.service'
import { applyTenantScope } from '../../shared/tenant/tenant-scope.util'
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
    // 每个条目既可能是 ID 也可能是用户名，一并查出后按入参位置对回真实 ID
    const placeholders = entries.map(() => '?').join(',')
    const existings = await this.dataSource.query<Array<{ id: string; username: string }>>(
      `SELECT id, username FROM sys_user WHERE (id IN (${placeholders}) OR username IN (${placeholders})) AND del_flag = 0`,
      [...entries, ...entries]
    )
    const byKey = new Map<string, string>()
    for (const row of existings) {
      byKey.set(row.id, row.id)
      byKey.set(row.username, row.id)
    }
    const missing = entries.filter(entry => !byKey.has(entry))
    if (missing.length > 0) {
      throw new BadRequestException(`以下接收人不存在或已删除：${missing.join('、')}`)
    }
    const validIds = [...new Set(entries.map(entry => byKey.get(entry) as string))]
    if (validIds.length === 0) {
      throw new BadRequestException('接收人不存在或已删除')
    }

    // 多步写必须事务；事务内一律 manager.getRepository()（默认连接看不到未提交数据）
    return this.dataSource.transaction(async manager => {
      const message = await manager.getRepository(SysMessageEntity).save({
        title: dto.title,
        content: dto.content,
        msgType: dto.msgType ?? 'send',
        senderId: senderId ?? null,
        tenantId: TenantContext.currentTenantId() ?? 1,
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
  async list(query: QueryMessageDto & { page?: number; pageSize?: number }): Promise<PaginationType<SysMessageEntity>> {
    const qb = this.messageRepo.createQueryBuilder('m').orderBy('m.createdAt', 'DESC')
    applyTenantScope(qb, 'm')
    if (query.keyword) {
      qb.andWhere('m.title LIKE :keyword', { keyword: `%${query.keyword}%` })
    }
    if (query.msgType) {
      qb.andWhere('m.msgType = :msgType', { msgType: query.msgType })
    }
    return paginate(qb, { page: query.page, pageSize: query.pageSize })
  }

  /** 删除发送记录（管理端）：连同接收人关联一起删 */
  async remove(id: string): Promise<void> {
    await this.dataSource.transaction(async manager => {
      await manager.getRepository(SysMessageEntity).delete(id)
      await manager.getRepository(SysMessageUserEntity).delete({ messageId: id })
    })
  }

  /** 我的消息分页（登录用户；raw 投影 + 手动 count） */
  async mine(userId: string, query: QueryMyMessageDto & { page?: number; pageSize?: number }): Promise<PaginationType<MyMessageRow>> {
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
    const rows = await this.messageUserRepo.find({
      where: { messageId: id },
      select: { userId: true, isRead: true, readAt: true }
    })
    return rows.map(row => ({ userId: row.userId, isRead: row.isRead, readAt: row.readAt ?? null }))
  }
}
