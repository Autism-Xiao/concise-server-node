import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { BizOrderEntity } from './entities/biz_order.entity'
import { BizOrderV1Controller } from './biz_order.v1.controller'
import { BizOrderService } from './biz_order.service'

/** 订单模块（生成器产物） */
@Module({
  imports: [TypeOrmModule.forFeature([BizOrderEntity])],
  controllers: [BizOrderV1Controller],
  providers: [BizOrderService],
  exports: [BizOrderService]
})
export class BizOrderModule {}
