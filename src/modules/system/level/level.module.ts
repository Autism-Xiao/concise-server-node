import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { LevelEntity } from './entities/level.entity'
import { LevelService } from './level.service'
import { LevelV1Controller } from './level.v1.controller'

@Module({
  imports: [TypeOrmModule.forFeature([LevelEntity])],
  controllers: [LevelV1Controller],
  providers: [LevelService],
  exports: [LevelService, TypeOrmModule]
})
export class LevelModule {}
