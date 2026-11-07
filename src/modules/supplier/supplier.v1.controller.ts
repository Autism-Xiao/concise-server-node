import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../common/decorators/oper-log.decorator'
import { Perms } from '../../common/decorators/perms.decorator'
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto'
import { SupplierService } from './supplier.service'

/** 供应商 v1 接口：统一挂 /api/v1，按钮权限 supplier:* */
@ApiTags('供应商')
@ApiBearerAuth('jwt')
@Controller('v1/suppliers')
export class SupplierV1Controller {
  constructor(private readonly supplierService: SupplierService) {}

  @ApiOperation({ summary: '供应商分页', description: '需 supplier:list' })
  @Perms('supplier:list')
  @Get()
  list(@Query() query: { page?: number; pageSize?: number; keyword?: string }) {
    return this.supplierService.listByQuery(query)
  }

  @ApiOperation({ summary: '供应商详情', description: '需 supplier:list' })
  @Perms('supplier:list')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.supplierService.findOne(id)
  }

  @ApiOperation({ summary: '新增供应商', description: '需 supplier:add' })
  @Perms('supplier:add')
  @OperLog('供应商')
  @Post()
  create(@Body() dto: CreateSupplierDto) {
    return this.supplierService.create(dto)
  }

  @ApiOperation({ summary: '修改供应商', description: '需 supplier:update' })
  @Perms('supplier:update')
  @OperLog('供应商')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSupplierDto) {
    return this.supplierService.update(id, dto)
  }

  @ApiOperation({ summary: '删除供应商', description: '需 supplier:delete' })
  @Perms('supplier:delete')
  @OperLog('供应商')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.supplierService.delete(id)
  }
}
