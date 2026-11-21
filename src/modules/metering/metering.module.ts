import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { MeteringInterceptor } from './metering.interceptor'
import { MeteringV1Controller } from './metering.v1.controller'
import { MeteringService } from './metering.service'
import { TenantUsageEntity } from './entities/tenant-usage.entity'

/**
 * 用量计量：全局导出 service，供文件中心等业务模块主动埋点；
 * HTTP 调用量由 MeteringInterceptor 在 AppModule 里统一挂全局。
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([TenantUsageEntity])],
  controllers: [MeteringV1Controller],
  providers: [MeteringService, MeteringInterceptor],
  exports: [MeteringService, MeteringInterceptor]
})
export class MeteringModule {}
