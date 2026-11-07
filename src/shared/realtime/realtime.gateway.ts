import { Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from '@nestjs/websockets'
import type { Server, Socket } from 'socket.io'

import { RealtimeService, USER_ROOM_KEY } from './realtime.service'

/**
 * WebSocket 网关
 *
 * 鉴权：握手时前端必须带 `auth: { token: <accessToken> }`，此处验签并把用户挂进
 * `user:<id>` 房间；无效/过期 token 直接断开（客户端不会重连成功，避免死循环）。
 *
 * 为什么在 handleConnection 里踢而不是WsGuard：连接层的鉴权要在「拿到 socket 引用」
 * 的同一个生命周期里完成断开，Guard 拿不到方便的 disconnect 语义。
 */
@WebSocketGateway({
  path: '/api/ws',
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling']
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name)

  @WebSocketServer()
  server!: Server

  constructor(
    private readonly jwt: JwtService,
    private readonly realtime: RealtimeService
  ) {}

  afterInit(): void {
    this.realtime.attachServer(this.server)
  }

  handleConnection(client: Socket): void {
    const token = (client.handshake.auth?.token as string | undefined) ?? (client.handshake.query?.token as string | undefined) ?? ''
    if (!token) {
      client.emit('error', { message: '缺少 token' })
      client.disconnect(true)
      return
    }
    try {
      const payload = this.jwt.verify<{ id?: string; sub?: string; username?: string }>(token)
      const userId = payload.id ?? payload.sub
      if (!userId) {
        client.disconnect(true)
        return
      }
      client.data.userId = userId
      client.data.username = payload.username
      void client.join(`${USER_ROOM_KEY}${userId}`)
      client.emit('hello', { userId })
      this.logger.debug(`WS 已连接 userId=${userId} socket=${client.id}`)
    } catch {
      client.emit('error', { message: 'token 无效或已过期' })
      client.disconnect(true)
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`WS 已断开 userId=${client.data?.userId ?? '未知'} socket=${client.id}`)
  }

  /** 心跳探活：前端定时 ping，服务端回 pong */
  @SubscribeMessage('ping')
  pong(@ConnectedSocket() client: Socket): { event: string; data: string } {
    return { event: 'pong', data: `${client.data?.userId ?? ''}` }
  }
}
