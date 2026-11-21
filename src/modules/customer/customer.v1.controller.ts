import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Request } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../common/decorators/oper-log.decorator'
import { Perms } from '../../common/decorators/perms.decorator'
import { CreateCustomerDto, ListCustomerDto, UpdateCustomerDto } from './dto/customer.dto'
import { CustomerService } from './customer.service'

/** owner 级数据范围所需的最小 actor 结构（JwtStrategy 注入的 req.user 满足它） */
interface OwnerRequest {
  user?: { id: string; isPlatformAdmin?: number; roles?: Array<{ dataScope?: number | null }> | null }
}

/** 客户 v1 接口：统一挂 /api/v1，按钮权限 customer:* */
@ApiTags('客户')
@ApiBearerAuth('jwt')
@Controller('v1/customers')
export class CustomerV1Controller {
  constructor(private readonly customerService: CustomerService) {}

  @ApiOperation({ summary: '客户分页', description: '需 customer:list；角色 data_scope=仅本人时只看自己创建的客户' })
  @Perms('customer:list')
  @Get()
  list(@Query() query: ListCustomerDto, @Request() req: OwnerRequest) {
    return this.customerService.listByQuery(query, req.user)
  }

  @ApiOperation({ summary: '客户详情', description: '需 customer:list；角色 data_scope=仅本人时只能看自己创建的客户' })
  @Perms('customer:list')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: OwnerRequest) {
    return this.customerService.findOneScoped(id, req.user)
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
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCustomerDto, @Request() req: OwnerRequest) {
    return this.customerService.update(id, dto, req.user)
  }

  @ApiOperation({ summary: '删除客户', description: '需 customer:delete' })
  @Perms('customer:delete')
  @OperLog('客户')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: OwnerRequest) {
    return this.customerService.delete(id, req.user)
  }
}
