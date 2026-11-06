import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { RoleEntity } from './entities/role.entity'
import { LEGACY_ROUTES_ENABLED } from '../../config/legacy-routes.config'
import { RoleController } from './role.controller'
import { RoleV1Controller } from './role.v1.controller'
import { RoleService } from './role.service'

@Module({
  imports: [TypeOrmModule.forFeature([RoleEntity])],
  controllers: [RoleV1Controller, ...(LEGACY_ROUTES_ENABLED ? [RoleController] : [])],
  providers: [RoleService],
  exports: [RoleService, TypeOrmModule]
})
export class RoleModule {}
