import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'

import { jwtConfig, type JwtConfig } from '../../config'
import { LEGACY_ROUTES_ENABLED } from '../../config/legacy-routes.config'
import { UserModule } from '../user/user.module'
import { MenuModule } from '../menu/menu.module'
import { LogModule } from '../system/log/log.module'
import { RedisModule } from '../../shared/redis/redis.module'
import { OnlineModule } from '../ops/online/online.module'
import { AuthController } from './controllers/auth.controller'
import { AuthV1Controller } from './controllers/auth.v1.controller'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { AuthService } from './services/auth.service'
import { CaptchaService } from './services/captcha.service'
import { JwtStrategy } from './strategies/jwt.strategy'

@Module({
  imports: [
    UserModule,
    MenuModule,
    LogModule,
    RedisModule,
    // 在线用户/强制下线：JwtStrategy 用它的会话登记与令牌黑名单
    OnlineModule,
    JwtModule.registerAsync({
      // 直接注入 jwt 命名空间（ConfigModule 为全局模块，无需 imports）
      inject: [jwtConfig.KEY],
      useFactory: (jwt: JwtConfig) => ({
        secret: jwt.secret,
        signOptions: { expiresIn: jwt.expiresIn }
      })
    })
  ],
  // 旧版（无 /v1）控制器默认不注册，见 config/legacy-routes.config.ts
  controllers: [AuthV1Controller, ...(LEGACY_ROUTES_ENABLED ? [AuthController] : [])],
  providers: [AuthService, CaptchaService, JwtStrategy, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard]
})
export class AuthModule {}
