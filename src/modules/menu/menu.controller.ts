import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Roles } from '../../common/decorators/roles.decorator'
import { CreateMenuDto } from './dto/create-menu.dto'
import { UpdateMenuDto } from './dto/update-menu.dto'
import { MenuEntity } from './entities/menu.entity'
import { MenuService } from './menu.service'

@ApiTags('菜单管理')
@ApiBearerAuth('jwt')
@Roles('admin')
@Controller('menus')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @ApiOperation({ summary: '菜单树（目录/菜单/按钮三级结构，前端动态路由数据源）' })
  @Get('tree')
  tree() {
    return this.menuService.getTree()
  }

  @ApiOperation({ summary: '菜单全量列表（扁平）' })
  @ApiOkResponse({ description: '菜单列表', type: [MenuEntity] })
  @Get()
  list() {
    return this.menuService.listAll()
  }

  @ApiOperation({ summary: '菜单详情' })
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.menuService.findOne(id)
  }

  @ApiOperation({ summary: '创建菜单' })
  @Post()
  create(@Body() dto: CreateMenuDto) {
    return this.menuService.create(dto)
  }

  @ApiOperation({ summary: '更新菜单' })
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMenuDto) {
    return this.menuService.update(id, dto)
  }

  @ApiOperation({ summary: '删除菜单' })
  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.menuService.delete(id)
  }
}
