import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Request } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../common/decorators/oper-log.decorator'
import { Perms } from '../../common/decorators/perms.decorator'
import { Sensitive } from '../../common/decorators/sensitive.decorator'
import { CreateBizOrderDto, ListBizOrderDto, UpdateBizOrderDto } from './dto/biz_order.dto'
import { BizOrderService } from './biz_order.service'

/** owner 级数据范围所需的最小 actor 结构 */
interface OwnerRequest {
  user?: { id: string; isPlatformAdmin?: number; roles?: Array<{ dataScope?: number | null }> | null; superviseDeptIds?: string[] | null }
}

/** 订单 v1 接口：统一挂 /api/v1，按钮权限 biz_order:* */
@ApiTags('订单')
@ApiBearerAuth('jwt')
@Sensitive('amount')
@Controller('v1/biz_orders')
export class BizOrderV1Controller {
  constructor(private readonly bizOrderService: BizOrderService) {}

  @ApiOperation({ summary: '订单分页', description: '需 biz_order:list；角色 data_scope=仅本人时只看自己创建的订单' })
  @Perms('biz_order:list')
  @Get()
  list(@Query() query: ListBizOrderDto, @Request() req: OwnerRequest) {
    return this.bizOrderService.listByQuery(query, req.user)
  }

  @ApiOperation({ summary: '订单详情', description: '需 biz_order:list；角色 data_scope=仅本人时只能看自己创建的订单' })
  @Perms('biz_order:list')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: OwnerRequest) {
    return this.bizOrderService.findOneScoped(id, req.user)
  }

  @ApiOperation({ summary: '新增订单', description: '需 biz_order:add' })
  @Perms('biz_order:add')
  @OperLog('订单')
  @Post()
  create(@Body() dto: CreateBizOrderDto) {
    return this.bizOrderService.create(dto)
  }

  @ApiOperation({ summary: '修改订单', description: '需 biz_order:update' })
  @Perms('biz_order:update')
  @OperLog('订单')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBizOrderDto, @Request() req: OwnerRequest) {
    return this.bizOrderService.update(id, dto, req.user)
  }

  @ApiOperation({ summary: '删除订单', description: '需 biz_order:delete' })
  @Perms('biz_order:delete')
  @OperLog('订单')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: OwnerRequest) {
    return this.bizOrderService.delete(id, req.user)
  }
}
