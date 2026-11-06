import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { createObserveModule } from '@nestjs/observe'

import { configs } from './config'
import { validateEnv } from './config/env.validation'
import { AllExceptionsFilter } from './common/filters/any-exception.filter'
import { TransformInterceptor } from './common/interceptors/transform.interceptor'
import { OperLogInterceptor } from './common/interceptors/oper-log.interceptor'
import { RolesGuard } from './common/guards/roles.guard'
import { PermsGuard } from './common/guards/perms.guard'
import { RateLimitGuard } from './common/guards/rate-limit.guard'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { LoggerService } from './shared/logger/logger.service'
import { DatabaseModule } from './shared/database/database.module'
import { RateLimitModule } from './shared/rate-limit/rate-limit.module'
import { PermissionCacheModule } from './shared/permission-cache/permission-cache.module'
import { UserModule } from './modules/user/user.module'
import { AuthModule } from './modules/auth/auth.module'
import { RoleModule } from './modules/role/role.module'
import { MenuModule } from './modules/menu/menu.module'
import { LogModule } from './modules/system/log/log.module'
import { DeptModule } from './modules/system/dept/dept.module'
import { ScheduleModule } from './modules/schedule/schedule.module'
import { RegionModule } from './modules/system/region/region.module'
import { DictModule } from './modules/system/dict/dict.module'
import { NoticeModule } from './modules/system/notice/notice.module'
import { TaskModule } from './modules/system/task/task.module'
import { WatermarkModule } from './modules/system/watermark/watermark.module'
import { LevelModule } from './modules/system/level/level.module'
import { PostModule } from './modules/system/post/post.module'
import { JobModule } from './modules/ops/job/job.module'
import { OnlineModule } from './modules/ops/online/online.module'
import { MonitorModule } from './modules/ops/monitor/monitor.module'
import { ToolsModule } from './modules/tools/tools.module'
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard'

export const { ObserveModule, ObserveInstrument } = createObserveModule()

@Module({
  imports: [
    // 多个 env 文件时，第一个优先级最高；validate 在启动期拦截缺失/格式错误的配置
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
      envFilePath: ['.env.local', '.env'],
      load: [...configs],
      validate: validateEnv
    }),
    // 数据库连接（TypeORM + MySQL）
    DatabaseModule,
    // 计数基础设施（限流 / 登录失败锁定），全局模块
    RateLimitModule,
    // 权限集合缓存（按角色，Redis 优先，写侧主动失效），全局模块
    PermissionCacheModule,
    // 业务模块
    UserModule,
    AuthModule,
    RoleModule,
    MenuModule,
    LogModule,
    DeptModule,
    ScheduleModule,
    RegionModule,
    DictModule,
    NoticeModule,
    TaskModule,
    WatermarkModule,
    LevelModule,
    PostModule,
    // 运维管理：定时任务（sys_quartz_job）/ 在线用户 / 服务与缓存监控
    JobModule,
    OnlineModule,
    MonitorModule,
    // 公共工具模块（上传/存储）
    ToolsModule,
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
    // 全局异常过滤 + 统一响应包装 + 操作日志
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: OperLogInterceptor },
    // 全局守卫：先限流（最便宜的拒绝），再 JWT 认证（@Public() 放行），再角色鉴权（@Roles()），最后按钮级权限（@Perms()）
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermsGuard }
  ]
})
export class AppModule {}
