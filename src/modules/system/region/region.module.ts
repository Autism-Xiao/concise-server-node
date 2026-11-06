import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { RegionEntity } from './entities/region.entity'
import { RegionV1Controller } from './region.v1.controller'
import { RegionService } from './region.service'

@Module({
  imports: [TypeOrmModule.forFeature([RegionEntity])],
  controllers: [RegionV1Controller],
  providers: [RegionService],
  exports: [RegionService]
})
export class RegionModule {}
