import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { DictItemService } from './dict-item.service'
import { DictItemV1Controller } from './dict-item.v1.controller'
import { DictService } from './dict.service'
import { DictV1Controller } from './dict.v1.controller'
import { SysDictEntity } from './entities/sys-dict.entity'
import { SysDictItemEntity } from './entities/sys-dict-item.entity'

/**
 * 数据字典模块（对齐 JeecgBoot：sys_dict + sys_dict_item）
 *
 * 两个 Service 各自管理一张表，放在同一模块里是因为字典项强依赖所属字典，
 * 拆成两个模块会互相 import，反而更绕。
 */
@Module({
  imports: [TypeOrmModule.forFeature([SysDictEntity, SysDictItemEntity])],
  controllers: [DictV1Controller, DictItemV1Controller],
  providers: [DictService, DictItemService],
  exports: [DictService, DictItemService, TypeOrmModule]
})
export class DictModule {}
