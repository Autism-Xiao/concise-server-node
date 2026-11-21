import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common'
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
import { FeatureGuard } from './common/guards/feature.guard'
import { QuotaGuard } from './common/guards/quota.guard'
import { RateLimitGuard } from './common/guards/rate-limit.guard'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { LoggerService } from './shared/logger/logger.service'
import { HealthModule } from './modules/health/health.module'
import { DatabaseModule } from './shared/database/database.module'
import { RateLimitModule } from './shared/rate-limit/rate-limit.module'
import { PermissionCacheModule } from './shared/permission-cache/permission-cache.module'
import { AuthCacheModule } from './shared/auth-cache/auth-cache.module'
import { UserModule } from './modules/user/user.module'
import { AuthModule } from './modules/auth/auth.module'
import { RoleModule } from './modules/role/role.module'
import { MenuModule } from './modules/menu/menu.module'
import { LogModule } from './modules/system/log/log.module'
import { DeptModule } from './modules/system/dept/dept.module'
import { ScheduleModule } from './modules/schedule/schedule.module'
import { RegionModule } from './modules/system/region/region.module'
import { MessageModule } from './modules/message/message.module'
import { RealtimeModule } from './shared/realtime/realtime.module'
import { SupplierModule } from './modules/supplier/supplier.module'
import { CodegenModule } from './modules/codegen/codegen.module'
import { DictModule } from './modules/system/dict/dict.module'
import { NoticeModule } from './modules/system/notice/notice.module'
import { TaskModule } from './modules/system/task/task.module'
import { WatermarkModule } from './modules/system/watermark/watermark.module'
import { UserSettingModule } from './modules/system/user-setting/user-setting.module'
import { SystemConfigModule } from './modules/system/config/config.module'
import { RedisModule } from './shared/redis/redis.module'
import { LevelModule } from './modules/system/level/level.module'
import { PostModule } from './modules/system/post/post.module'
import { JobModule } from './modules/ops/job/job.module'
import { OnlineModule } from './modules/ops/online/online.module'
import { MonitorModule } from './modules/ops/monitor/monitor.module'
import { ToolsModule } from './modules/tools/tools.module'
import { DashboardModule } from './modules/dashboard/dashboard.module'
import { TenantModule } from './modules/system/tenant/tenant.module'
import { CustomerModule } from './modules/customer/customer.module'
import { BizOrderModule } from './modules/biz_order/biz_order.module'
import { TenantContextModule } from './shared/tenant/tenant-context.module'
import { TenantMiddleware } from './shared/tenant/tenant.middleware'
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard'
import { ApiScopeGuard } from './common/guards/api-scope.guard'
import { OpenApiModule } from './modules/openapi/open.module'
import { QuotaModule } from './shared/quota/quota.module'
import { FeatureModule } from './shared/feature/feature.module'
import { MeteringModule } from './modules/metering/metering.module'
import { MeteringInterceptor } from './modules/metering/metering.interceptor'
import { SensitiveInterceptor } from './common/interceptors/sensitive.interceptor'

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
    HealthModule,
    // 计数基础设施（限流 / 登录失败锁定），全局模块
    RateLimitModule,
    // 权限集合缓存（按角色，Redis 优先，写侧主动失效），全局模块
    PermissionCacheModule,
    // 鉴权用户短缓存（JwtStrategy 读、账号写路径主动失效），全局模块
    AuthCacheModule,
    // 租户资源配额（sys_config 驱动的 Seats / Storage 上限），全局模块
    QuotaModule,
    // 租户级特性开关（sys_config feature.* 键，@FeatureFlag + FeatureGuard），全局模块
    FeatureModule,
    // Redis 共享连接：QuotaGuard 的增量计数器依赖（RateLimit/缓存模块各自按需 import）
    RedisModule,
    // 租户用量计量（sys_tenant_usage：API 调用 / 上传字节），全局模块
    MeteringModule,
    // 多租户上下文（AsyncLocalStorage + 归属解析），全局模块
    TenantContextModule,
    // 业务模块
    UserModule,
    AuthModule,
    RoleModule,
    MenuModule,
    LogModule,
    DeptModule,
    ScheduleModule,
    RegionModule,
    MessageModule,
    RealtimeModule,
    SupplierModule,
    DictModule,
    NoticeModule,
    // 待办任务（system/task）
    TaskModule,
    // 首页概览聚合（/v1/dashboard/overview：按权限逐块裁剪，不建表）
    DashboardModule,
    WatermarkModule,
    // 用户界面设置（sys_user_setting：/v1/users/me/settings，前端本地兜底的云端副本）
    UserSettingModule,
    // 代码生成器（包装 scripts/gen-module.cjs：预览走临时目录，生成本机写盘，生产默认禁用）
    CodegenModule,
    LevelModule,
    PostModule,
    // 多租户管理（sys_tenant + sys_user_tenant）
    TenantModule,
    // 运维管理：定时任务（sys_quartz_job）/ 在线用户 / 服务与缓存监控
    JobModule,
    OnlineModule,
    MonitorModule,
    // 公共工具模块（上传/存储）
    ToolsModule,
    // 系统参数配置（sys_config：密码策略等运行时可调项，改完即时生效）
    SystemConfigModule,
    CustomerModule,
    BizOrderModule,
    // 开放平台：应用凭证（client_credentials）/ Webhook 订阅与派发 / 开放接口（/v1/open/**）
    OpenApiModule,
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
    // 计量放最内层：只观察 handler 的原始成功/失败，不感知外层响应包装
    { provide: APP_INTERCEPTOR, useClass: MeteringInterceptor },
    // 字段级脱敏最靠近 handler：改的是原始数据，外层再统一包装 {code,result}
    { provide: APP_INTERCEPTOR, useClass: SensitiveInterceptor },
    // 全局守卫：先限流（最便宜的拒绝），再 JWT 认证（@Public() 放行），再角色鉴权（@Roles()），再按钮级权限（@Perms()），最后开放接口 scope（@ApiScope()，只约束应用令牌）
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermsGuard },
    // 特性开关：@FeatureFlag 标注的端点在开关关闭的租户视角整体 403（无标注端点直通）
    { provide: APP_GUARD, useClass: FeatureGuard },
    // 租户 API 配额：tenant.quota.apiCalls > 0 时按月账期拦截超限请求（429，白名单见守卫注释）
    { provide: APP_GUARD, useClass: QuotaGuard },
    { provide: APP_GUARD, useClass: ApiScopeGuard }
  ]
})
export class AppModule implements NestModule {
  /**
   * 租户中间件挂到所有路由：只有中间件的 `TenantContext.run(store, next)` 能把
   * AsyncLocalStorage 上下文包住后续整条链路（Guard / Interceptor / Handler）。
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('*')
  }
}
