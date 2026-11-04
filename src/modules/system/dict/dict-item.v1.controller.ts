import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { CreateDictItemDto } from './dto/create-dict-item.dto'
import { QueryDictItemDto } from './dto/query-dict-item.dto'
import { UpdateDictItemDto } from './dto/update-dict-item.dto'
import { DictItemService } from './dict-item.service'
import { SysDictItemEntity } from './entities/sys-dict-item.entity'

/**
 * 字典项接口 V1：/api/v1/dict-items
 *
 * - code/:code 是前端下拉框数据源，所有登录用户可用（不加 @Roles）
 * - 其余管理接口限 admin + 对应按钮权限
 */
@ApiTags('字典项 V1')
@ApiBearerAuth('jwt')
@Controller('v1/dict-items')
export class DictItemV1Controller {
  constructor(private readonly dictItemService: DictItemService) {}

  @ApiOperation({ summary: '按字典编码取启用字典项（v1）', description: '所有登录用户可用，前端下拉框数据源；字典不存在或已删除返回 400' })
  @Get('code/:code')
  listByCode(@Param('code') code: string) {
    return this.dictItemService.listByCode(code)
  }

  @ApiOperation({ summary: '字典项分页列表（v1）', description: '可按 dictId / keyword / status 过滤，按 sort_order 升序' })
  @ApiOkResponse({ description: '分页结果', type: [SysDictItemEntity] })
  @Roles('admin')
  @Perms('system:dict:list')
  @Get()
  list(@Query() query: QueryDictItemDto) {
    return this.dictItemService.listByQuery(query)
  }

  @ApiOperation({ summary: '字典项详情（v1）' })
  @Roles('admin')
  @Perms('system:dict:list')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.dictItemService.findDetail(id)
  }

  @ApiOperation({ summary: '创建字典项（v1）', description: '所属字典必须存在；同一字典下 itemValue 唯一' })
  @Roles('admin')
  @OperLog('字典项')
  @Perms('system:dict:add')
  @Post()
  create(@Body() dto: CreateDictItemDto, @Request() req: { user: { username: string } }) {
    return this.dictItemService.createItem(dto, req.user?.username)
  }

  @ApiOperation({ summary: '更新字典项（v1）' })
  @Roles('admin')
  @OperLog('字典项')
  @Perms('system:dict:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDictItemDto, @Request() req: { user: { username: string } }) {
    return this.dictItemService.updateItem(id, dto, req.user?.username)
  }

  @ApiOperation({ summary: '删除字典项（v1）', description: '硬删（sys_dict_item 没有 del_flag）' })
  @Roles('admin')
  @OperLog('字典项')
  @Perms('system:dict:delete')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.dictItemService.deleteItem(id)
    return { deleted: 1 }
  }
}
