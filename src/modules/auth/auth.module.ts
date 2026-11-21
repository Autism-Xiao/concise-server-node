import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { TypeOrmModule } from '@nestjs/typeorm'

import { jwtConfig, type JwtConfig } from '../../config'
import { UserEntity } from '../user/entities/user.entity'
import { OpenApiModule } from '../openapi/open.module'
import { UserModule } from '../user/user.module'
import { MenuModule } from '../menu/menu.module'
import { LogModule } from '../system/log/log.module'
import { SystemConfigModule } from '../system/config/config.module'
import { RedisModule } from '../../shared/redis/redis.module'
import { MailerModule } from '../../shared/mailer/mailer.module'
import { OnlineModule } from '../ops/online/online.module'
import { AuthV1Controller } from './controllers/auth.v1.controller'
import { SsoV1Controller } from './controllers/sso.v1.controller'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { AuthService } from './services/auth.service'
import { CaptchaService } from './services/captcha.service'
import { PasswordResetService } from './services/password-reset.service'
import { RememberMeService } from './services/remember-me.service'
import { SsoService } from './services/sso.service'
import { TotpService } from './services/totp.service'
import { UserBackupCodeEntity } from './entities/user-backup-code.entity'
import { JwtStrategy } from './strategies/jwt.strategy'

@Module({
  imports: [
    UserModule,
    MenuModule,
    LogModule,
    RedisModule,
    // JwtStrategy 要实时校验应用令牌（停用/删除即时生效）；OpenApiModule 不依赖本模块，无循环
    OpenApiModule,
    // TotpService 直接读写 sys_user 的 totp 两列：跨模块注入仓库需本模块 forFeature 注册实体
    TypeOrmModule.forFeature([UserEntity, UserBackupCodeEntity]),
    // 在线用户/强制下线：JwtStrategy 用它的会话登记与令牌黑名单
    OnlineModule,
    // 忘记密码：发信走邮件通道（开关与信封读 sys_config）
    MailerModule,
    // PasswordResetService 直接读 mail.resetCode.ttlMinutes
    SystemConfigModule,
    JwtModule.registerAsync({
      // 直接注入 jwt 命名空间（ConfigModule 为全局模块，无需 imports）
      inject: [jwtConfig.KEY],
      useFactory: (jwt: JwtConfig) => ({
        secret: jwt.secret,
        signOptions: { expiresIn: jwt.expiresIn }
      })
    })
  ],
  controllers: [AuthV1Controller, SsoV1Controller],
  providers: [AuthService, CaptchaService, SsoService, TotpService, PasswordResetService, RememberMeService, JwtStrategy, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard]
})
export class AuthModule {}
