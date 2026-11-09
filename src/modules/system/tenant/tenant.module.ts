import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { TenantEntity } from './entities/tenant.entity'
import { UserTenantEntity } from './entities/user-tenant.entity'
import { TenantService } from './tenant.service'
import { TenantProvisionService } from './tenant-provision.service'
import { TenantV1Controller } from './tenant.v1.controller'

/**
 * 租户管理（sys_tenant + sys_user_tenant）；隔离逻辑在 shared/tenant，全局中间件注入上下文
 *
 * TenantProvisionService 依赖的 PermissionCacheService / AuthUserCacheService 都是 @Global 模块，
 * 这里不必再 imports，避免和 role 模块形成环。
 */
@Module({
  imports: [TypeOrmModule.forFeature([TenantEntity, UserTenantEntity])],
  controllers: [TenantV1Controller],
  providers: [TenantService, TenantProvisionService],
  exports: [TenantService, TenantProvisionService]
})
export class TenantModule {}
