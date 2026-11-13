import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { CustomerEntity } from './entities/customer.entity'
import { CustomerV1Controller } from './customer.v1.controller'
import { CustomerService } from './customer.service'

/** 客户模块（生成器产物） */
@Module({
  imports: [TypeOrmModule.forFeature([CustomerEntity])],
  controllers: [CustomerV1Controller],
  providers: [CustomerService],
  exports: [CustomerService]
})
export class CustomerModule {}
