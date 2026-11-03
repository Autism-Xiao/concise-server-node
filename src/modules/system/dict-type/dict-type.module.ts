import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { DictTypeEntity } from './entities/dict-type.entity'
import { DictTypeController } from './dict-type.controller'
import { DictTypeService } from './dict-type.service'

@Module({
  imports: [TypeOrmModule.forFeature([DictTypeEntity])],
  controllers: [DictTypeController],
  providers: [DictTypeService],
  exports: [DictTypeService]
})
export class DictTypeModule {}
