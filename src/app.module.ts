import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { createObserveModule } from '@nestjs/observe'

import { configs } from './config'
import { AllExceptionsFilter } from './common/filters/any-exception.filter'
import { TransformInterceptor } from './common/interceptors/transform.interceptor'
import { RolesGuard } from './common/guards/roles.guard'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { LoggerService } from './shared/logger/logger.service'
import { DatabaseModule } from './shared/database/database.module'
import { UserModule } from './modules/user/user.module'
import { AuthModule } from './modules/auth/auth.module'
import { RoleModule } from './modules/role/role.module'
import { MenuModule } from './modules/menu/menu.module'
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard'

export const { ObserveModule, ObserveInstrument } = createObserveModule()

@Module({
  imports: [
    // 多个 env 文件时，第一个优先级最高
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
      envFilePath: ['.env.local', '.env'],
      load: [...configs]
    }),
    // 数据库连接（TypeORM + MySQL）
    DatabaseModule,
    // 业务模块
    UserModule,
    AuthModule,
    RoleModule,
    MenuModule,
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com,
    // then run `npx @nestjs/observe link` to write your key pair into .env.
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY ?? 'YOUR_APP_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET ?? 'YOUR_APP_SECRET',
      serviceId: 'concise-server-node'
    })
  ],
  controllers: [AppController],
  providers: [
    AppService,
    LoggerService,
    // 全局异常过滤 + 统一响应包装
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    // 全局守卫：先 JWT 认证（@Public() 放行），再角色鉴权（@Roles() 匹配）
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard }
  ]
})
export class AppModule {}
