import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { MenuEntity } from './entities/menu.entity'
import { MenuController } from './menu.controller'
import { MenuService } from './menu.service'
import { MenuV1Controller } from './menu.v1.controller'

@Module({
  imports: [TypeOrmModule.forFeature([MenuEntity])],
  controllers: [MenuController, MenuV1Controller],
  providers: [MenuService],
  exports: [MenuService, TypeOrmModule]
})
export class MenuModule {}
