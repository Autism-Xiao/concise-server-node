import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { TypeOrmModule } from '@nestjs/typeorm'
import type { ConfigType } from '@nestjs/config'

import { jwtConfig } from '../../config'
import { UserEntity } from '../user/entities/user.entity'
import { AppV1Controller } from './app.v1.controller'
import { AppService } from './app.service'
import { OpenV1Controller } from './open.v1.controller'
import { SysAppEntity } from './entities/sys-app.entity'
import { SysAppSecretEntity } from './entities/sys-app-secret.entity'
import { SysWebhookDeliveryEntity } from './entities/sys-webhook-delivery.entity'
import { SysWebhookEntity } from './entities/sys-webhook.entity'
import { TokenV1Controller } from './token.v1.controller'
import { WebhookService } from './webhook.service'
import { WebhookV1Controller } from './webhook.v1.controller'

/**
 * 开放平台模块
 *
 * - /v1/open/token   换取应用令牌（@Public，独立 snake_case 响应）
 * - /v1/apps         应用管理（system:app:* 权限）
 * - /v1/webhooks     订阅与投递流水（system:webhook:* 权限）
 * - /v1/open/**      开放接口（@ApiScope，应用令牌 + scope 判定）
 *
 * WebhookService 是业务事件的出口：业务模块 import 本模块后调
 * `webhookService.dispatch('user.created', {...})`，派发失败不影响业务。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysAppEntity, SysAppSecretEntity, SysWebhookEntity, SysWebhookDeliveryEntity, UserEntity]),
    JwtModule.registerAsync({
      // 与用户登录令牌同一个 secret：开放令牌复用 JwtStrategy 的签名校验，
      // 靠 payload.app=true 区分应用身份（见 jwt.strategy.ts）
      inject: [jwtConfig.KEY],
      useFactory: (jwt: ConfigType<typeof jwtConfig>) => ({ secret: jwt.secret })
    })
  ],
  controllers: [TokenV1Controller, AppV1Controller, WebhookV1Controller, OpenV1Controller],
  providers: [AppService, WebhookService],
  exports: [AppService, WebhookService]
})
export class OpenApiModule {}
