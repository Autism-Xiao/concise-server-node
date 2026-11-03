import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { DictTypeEntity } from '../dict-type/entities/dict-type.entity'
import { DictItemEntity } from './entities/dict-item.entity'
import { DictItemController } from './dict-item.controller'
import { DictItemService } from './dict-item.service'

@Module({
  imports: [TypeOrmModule.forFeature([DictItemEntity, DictTypeEntity])],
  controllers: [DictItemController],
  providers: [DictItemService],
  exports: [DictItemService]
})
export class DictItemModule {}
