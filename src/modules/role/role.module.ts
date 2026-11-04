import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { RoleEntity } from './entities/role.entity'
import { RoleController } from './role.controller'
import { RoleV1Controller } from './role.v1.controller'
import { RoleService } from './role.service'

@Module({
  imports: [TypeOrmModule.forFeature([RoleEntity])],
  controllers: [RoleController, RoleV1Controller],
  providers: [RoleService],
  exports: [RoleService, TypeOrmModule]
})
export class RoleModule {}
