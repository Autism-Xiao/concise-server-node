import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { SupplierEntity } from './entities/supplier.entity'
import { SupplierV1Controller } from './supplier.v1.controller'
import { SupplierService } from './supplier.service'

/** 供应商模块（生成器产物） */
@Module({
  imports: [TypeOrmModule.forFeature([SupplierEntity])],
  controllers: [SupplierV1Controller],
  providers: [SupplierService],
  exports: [SupplierService]
})
export class SupplierModule {}
