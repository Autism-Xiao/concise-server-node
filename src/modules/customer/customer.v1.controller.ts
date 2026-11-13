import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../common/decorators/oper-log.decorator'
import { Perms } from '../../common/decorators/perms.decorator'
import { CreateCustomerDto, ListCustomerDto, UpdateCustomerDto } from './dto/customer.dto'
import { CustomerService } from './customer.service'

/** 客户 v1 接口：统一挂 /api/v1，按钮权限 customer:* */
@ApiTags('客户')
@ApiBearerAuth('jwt')
@Controller('v1/customers')
export class CustomerV1Controller {
  constructor(private readonly customerService: CustomerService) {}

  @ApiOperation({ summary: '客户分页', description: '需 customer:list' })
  @Perms('customer:list')
  @Get()
  list(@Query() query: ListCustomerDto) {
    return this.customerService.listByQuery(query)
  }

  @ApiOperation({ summary: '客户详情', description: '需 customer:list' })
  @Perms('customer:list')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.customerService.findOne(id)
  }

  @ApiOperation({ summary: '新增客户', description: '需 customer:add' })
  @Perms('customer:add')
  @OperLog('客户')
  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.customerService.create(dto)
  }

  @ApiOperation({ summary: '修改客户', description: '需 customer:update' })
  @Perms('customer:update')
  @OperLog('客户')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCustomerDto) {
    return this.customerService.update(id, dto)
  }

  @ApiOperation({ summary: '删除客户', description: '需 customer:delete' })
  @Perms('customer:delete')
  @OperLog('客户')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.customerService.delete(id)
  }
}
