import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { MenuEntity } from '../../menu/entities/menu.entity'
import { TenantEntity } from './entities/tenant.entity'
import { UserTenantEntity } from './entities/user-tenant.entity'
import { TenantMenuEntity } from './entities/tenant-menu.entity'
import { UserModule } from '../../user/user.module'
import { SystemConfigModule } from '../config/config.module'
import { LogModule } from '../log/log.module'
import { TenantService } from './tenant.service'
import { TenantExportService } from './tenant-export.service'
import { TenantProvisionService } from './tenant-provision.service'
import { TenantPackageService } from './tenant-package.service'
import { TenantV1Controller } from './tenant.v1.controller'

/**
 * 租户管理（sys_tenant + sys_user_tenant）；隔离逻辑在 shared/tenant，全局中间件注入上下文
 *
 * TenantProvisionService 依赖的 PermissionCacheService / AuthUserCacheService 都是 @Global 模块，
 * 这里不必再 imports，避免和 role 模块形成环。
 *
 * UserModule 是为了 createAdmin（建租户管理员）：复用 UserService.create 的密码哈希、唯一性预检、
 * 界面设置初始化，不自己重写一套。UserModule 不反向依赖 TenantModule，无循环。
 *
 * forFeature 里的 MenuEntity 供 TenantPackageService 校验/组树（菜单表全平台共享，无租户隔离）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TenantEntity, UserTenantEntity, TenantMenuEntity, MenuEntity]),
    UserModule,
    // 自助开通的额度来自 sys_config（tenant.vip.maxTenants），不引拿不到 SystemConfigService
    SystemConfigModule,
    // switch 的代维审计要写 sys_log
    LogModule
  ],
  controllers: [TenantV1Controller],
  providers: [TenantService, TenantExportService, TenantProvisionService, TenantPackageService],
  exports: [TenantService, TenantExportService, TenantProvisionService, TenantPackageService]
})
export class TenantModule {}
