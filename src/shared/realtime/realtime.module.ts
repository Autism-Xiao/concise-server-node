import { Global, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'

import { jwtConfig, type JwtConfig } from '../../config'
import { ScheduleModule } from '../../modules/schedule/schedule.module'
import { RealtimeGateway } from './realtime.gateway'
import { RealtimeService } from './realtime.service'

/**
 * 实时推送模块（全局）
 *
 * WebSocket 网关（socket.io，path=/api/ws），JWT 握手鉴权，按用户分房间。
 * 任何模块直接注入 RealtimeService 即可推送：
 *  - pushToUser / pushToUsers：message:new（站内信）、reminder:triggered（日历提醒）、force-offline（强退）
 *  - broadcast：全站广播（预留）
 *
 * 做成 @Global 是因为推送的「生产者」散落在业务模块里（消息、在线、调度），
 * 逐个模块 imports 会把依赖图搅得很乱，全局注入最省心。
 */
@Global()
@Module({
  imports: [
    ScheduleModule,
    JwtModule.registerAsync({
      inject: [jwtConfig.KEY],
      useFactory: (jwt: JwtConfig) => ({
        secret: jwt.secret,
        signOptions: { expiresIn: jwt.expiresIn }
      })
    })
  ],
  providers: [RealtimeService, RealtimeGateway],
  exports: [RealtimeService]
})
export class RealtimeModule {}
