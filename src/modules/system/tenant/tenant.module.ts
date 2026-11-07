import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { TenantEntity } from './entities/tenant.entity'
import { UserTenantEntity } from './entities/user-tenant.entity'
import { TenantService } from './tenant.service'
import { TenantV1Controller } from './tenant.v1.controller'

/** 租户管理（sys_tenant + sys_user_tenant）；隔离逻辑在 shared/tenant，全局中间件注入上下文 */
@Module({
  imports: [TypeOrmModule.forFeature([TenantEntity, UserTenantEntity])],
  controllers: [TenantV1Controller],
  providers: [TenantService],
  exports: [TenantService]
})
export class TenantModule {}
