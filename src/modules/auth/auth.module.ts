import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import type { StringValue } from 'ms'

import { UserModule } from '../user/user.module'
import { MenuModule } from '../menu/menu.module'
import { LogModule } from '../system/log/log.module'
import { RedisModule } from '../../shared/redis/redis.module'
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
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: (configService.get<string>('JWT_EXPIRES_IN') || '2h') as StringValue }
      })
    })
  ],
  controllers: [AuthController, AuthV1Controller],
  providers: [AuthService, CaptchaService, JwtStrategy, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard]
})
export class AuthModule {}
