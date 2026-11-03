import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { MenuEntity } from './entities/menu.entity'
import { MenuController } from './menu.controller'
import { MenuService } from './menu.service'

@Module({
  imports: [TypeOrmModule.forFeature([MenuEntity])],
  controllers: [MenuController],
  providers: [MenuService],
  exports: [MenuService, TypeOrmModule]
})
export class MenuModule {}
