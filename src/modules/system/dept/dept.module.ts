import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { DeptEntity } from './entities/dept.entity'
import { LEGACY_ROUTES_ENABLED } from '../../../config/legacy-routes.config'
import { DeptController } from './dept.controller'
import { DeptV1Controller } from './dept.v1.controller'
import { DeptService } from './dept.service'

@Module({
  imports: [TypeOrmModule.forFeature([DeptEntity])],
  controllers: [DeptV1Controller, ...(LEGACY_ROUTES_ENABLED ? [DeptController] : [])],
  providers: [DeptService],
  exports: [DeptService]
})
export class DeptModule {}
