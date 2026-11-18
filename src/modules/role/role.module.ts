import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { RoleEntity } from './entities/role.entity'
import { TenantEntity } from '../system/tenant/entities/tenant.entity'
import { RoleV1Controller } from './role.v1.controller'
import { RoleService } from './role.service'

@Module({
  imports: [TypeOrmModule.forFeature([RoleEntity, TenantEntity])],
  controllers: [RoleV1Controller],
  providers: [RoleService],
  exports: [RoleService, TypeOrmModule]
})
export class RoleModule {}
