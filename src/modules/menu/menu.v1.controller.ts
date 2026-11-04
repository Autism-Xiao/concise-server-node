import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../common/decorators/oper-log.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { CreateMenuDto } from './dto/create-menu.dto'
import { UpdateMenuDto } from './dto/update-menu.dto'
import { MenuEntity } from './entities/menu.entity'
import { MenuService } from './menu.service'

/**
 * 菜单管理接口 V1：/api/v1/menus/**
 *
 * 版本策略：URL 前缀做版本，老版本路由（/api/menus/**）继续保留兼容；
 * 菜单管理页与角色授权弹窗的数据源都在这里，旧路由待全部迁移后统一下线。
 */
@ApiTags('菜单管理 V1')
@ApiBearerAuth('jwt')
@Roles('admin')
@Controller('v1/menus')
export class MenuV1Controller {
  constructor(private readonly menuService: MenuService) {}

  @ApiOperation({ summary: '菜单树（v1）', description: '目录/菜单/按钮三级结构，角色授权弹窗与登录权限接口共用同一张表' })
  @Get('tree')
  tree() {
    return this.menuService.getTree()
  }

  @ApiOperation({ summary: '菜单全量列表（v1，扁平，排除已删除）' })
  @ApiOkResponse({ description: '菜单列表', type: [MenuEntity] })
  @Get()
  list() {
    return this.menuService.listAll()
  }

  @ApiOperation({ summary: '菜单详情（v1）' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.menuService.findOne(id)
  }

  @ApiOperation({ summary: '创建菜单（v1）', description: '支持目录/菜单/按钮三种类型；父级必须存在' })
  @OperLog('菜单管理')
  @Post()
  create(@Body() dto: CreateMenuDto) {
    return this.menuService.create(dto)
  }

  @ApiOperation({ summary: '更新菜单（v1）', description: '换父级时校验父级存在且不形成循环层级' })
  @OperLog('菜单管理')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMenuDto) {
    return this.menuService.update(id, dto)
  }

  @ApiOperation({ summary: '删除菜单（v1）', description: '软删除（del_flag=1）；存在子菜单时拒绝，需先删子级' })
  @OperLog('菜单管理')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.menuService.delete(id)
  }
}
