import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Roles } from '../../common/decorators/roles.decorator'
import { CreateRoleDto } from './dto/create-role.dto'
import { UpdateRoleDto } from './dto/update-role.dto'
import { RoleEntity } from './entities/role.entity'
import { RoleService } from './role.service'

@ApiTags('角色管理')
@ApiBearerAuth('jwt')
@Roles('admin')
@Controller('roles')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @ApiOperation({ summary: '角色列表（全量，角色数量少不分页）' })
  @ApiOkResponse({ description: '角色列表', type: [RoleEntity] })
  @Get()
  list() {
    return this.roleService['roleRepository'].find({ relations: { menus: true } })
  }

  @ApiOperation({ summary: '角色详情（含已授权菜单）' })
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<RoleEntity> {
    return this.roleService.findOneWithMenus(id)
  }

  @ApiOperation({ summary: '创建角色', description: '可同时携带 menuIds 绑定菜单权限' })
  @Post()
  create(@Body() dto: CreateRoleDto): Promise<RoleEntity> {
    return this.roleService.createRole(dto)
  }

  @ApiOperation({ summary: '更新角色' })
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoleDto) {
    if (dto.menuIds) {
      return this.roleService.assignMenus(id, dto.menuIds).then(() => this.roleService.findOneWithMenus(id))
    }
    return this.roleService.update(id, dto)
  }

  @ApiOperation({ summary: '为角色绑定菜单权限（全量覆盖）' })
  @Put(':id/menus')
  async assignMenus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoleDto) {
    await this.roleService.assignMenus(id, dto.menuIds as number[])
    return this.roleService.findOneWithMenus(id)
  }

  @ApiOperation({ summary: '删除角色' })
  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.roleService.delete(id)
  }
}
