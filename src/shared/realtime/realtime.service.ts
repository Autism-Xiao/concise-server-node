import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import type { Server } from 'socket.io'

import { REMIND_EVENT_NAME, ReminderScheduler } from '../../modules/schedule/reminder.scheduler'

/** 用户房间前缀：一个用户多个浏览器标签共用一个房间 */
export const USER_ROOM_KEY = 'user:'

/** 实时事件名（服务端 → 客户端），前端按名监听 */
export const WS_EVENTS = {
  messageNew: 'message:new',
  reminderTriggered: 'reminder:triggered',
  forceOffline: 'force-offline'
} as const

export interface MessageNewPayload {
  id: string
  title: string
  content: string
  msgType: string
  createdAt: string
}

export interface ReminderPayload {
  eventId: number
  userId: string
  title: string
  message: string
  startTime: string
}

/**
 * 实时推送服务
 *
 * Server 引用由 Gateway 在 afterInit 时回填；WS 未就绪（或依赖缺失）时所有
 * push 方法静默降级为 no-op —— 推送永远是「锦上添花」，不能让业务写路径因它失败。
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name)
  private server: Server | null = null

  constructor(private readonly reminderScheduler: ReminderScheduler) {}

  /** 订阅日历提醒事件：调度器抢权成功后，这里把消息实时推给目标用户 */
  onModuleInit(): void {
    this.reminderScheduler.emitter.on(REMIND_EVENT_NAME, this.onReminder)
  }

  onModuleDestroy(): void {
    this.reminderScheduler.emitter.off(REMIND_EVENT_NAME, this.onReminder)
  }

  private readonly onReminder = (payload: ReminderPayload): void => {
    this.pushToUser(payload.userId, WS_EVENTS.reminderTriggered, {
      eventId: payload.eventId,
      title: payload.title,
      message: payload.message,
      startTime: payload.startTime
    })
  }

  /** 由 Gateway 在初始化完成后回填（不对外） */
  attachServer(server: Server): void {
    this.server = server
    this.logger.log('WebSocket 推送已就绪')
  }

  /** 当前在线连接数（运维监控用） */
  connectedCount(): number {
    return this.server?.sockets.sockets.size ?? 0
  }

  /** 推给单个用户的所有在线连接 */
  pushToUser(userId: string, event: string, payload: unknown): void {
    if (!this.server || !userId) return
    this.server.to(`${USER_ROOM_KEY}${userId}`).emit(event, payload)
  }

  /** 推给多个用户（去重；空列表直接返回） */
  pushToUsers(userIds: string[], event: string, payload: unknown): void {
    if (!this.server || userIds.length === 0) return
    const rooms = [...new Set(userIds.filter(Boolean))].map(id => `${USER_ROOM_KEY}${id}`)
    this.server.to(rooms).emit(event, payload)
  }

  /** 全站广播 */
  broadcast(event: string, payload: unknown): void {
    this.server?.emit(event, payload)
  }
}
