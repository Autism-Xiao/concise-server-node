import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { MenuEntity } from './entities/menu.entity'
import { LEGACY_ROUTES_ENABLED } from '../../config/legacy-routes.config'
import { MenuController } from './menu.controller'
import { MenuService } from './menu.service'
import { MenuV1Controller } from './menu.v1.controller'

@Module({
  imports: [TypeOrmModule.forFeature([MenuEntity])],
  controllers: [MenuV1Controller, ...(LEGACY_ROUTES_ENABLED ? [MenuController] : [])],
  providers: [MenuService],
  exports: [MenuService, TypeOrmModule]
})
export class MenuModule {}
