import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Roles } from '../../common/decorators/roles.decorator'
import { Perms } from '../../common/decorators/perms.decorator'
import { OperLog } from '../../common/decorators/oper-log.decorator'
import { CreateRoleDto } from './dto/create-role.dto'
import { QueryRoleDto } from './dto/query-role.dto'
import { UpdateRoleDto } from './dto/update-role.dto'
import { RoleEntity } from './entities/role.entity'
import { RoleService } from './role.service'

/**
 * 角色管理接口 V1：/api/v1/roles/**
 *
 * 版本策略：URL 前缀做版本，老版本路由（/api/roles/**）继续保留兼容；
 * 角色管理页与授权弹窗的数据源都在这里，旧路由待全部迁移后统一下线。
 */
@ApiTags('角色管理 V1')
@ApiBearerAuth('jwt')
@Roles('admin')
@Controller('v1/roles')
export class RoleV1Controller {
  constructor(private readonly roleService: RoleService) {}

  @ApiOperation({ summary: '角色列表（v1）', description: '全量返回（角色数量少不分页），含已授权菜单；keyword 模糊匹配名称/编码' })
  @ApiOkResponse({ description: '角色列表', type: [RoleEntity] })
  @Get()
  list(@Query() query: QueryRoleDto): Promise<RoleEntity[]> {
    return this.roleService.listByQuery(query)
  }

  @ApiOperation({ summary: '角色详情（v1，含已授权菜单）' })
  @ApiOkResponse({ description: '角色信息', type: RoleEntity })
  @Get(':id')
  findOne(@Param('id') id: string): Promise<RoleEntity> {
    return this.roleService.findOneWithMenus(id)
  }

  @ApiOperation({ summary: '创建角色（v1）', description: '32 位主键自动生成；roleCode 唯一；可同时携带 menuIds 绑定菜单权限' })
  @OperLog('角色管理')
  @Perms('system:role:add')
  @Post()
  create(@Body() dto: CreateRoleDto): Promise<RoleEntity> {
    return this.roleService.createRole(dto)
  }

  @ApiOperation({ summary: '更新角色（v1）', description: '内置 admin 角色的 roleCode 不可修改；menuIds 传入时全量覆盖授权（空数组即清空）' })
  @OperLog('角色管理')
  @Perms('system:role:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto): Promise<RoleEntity> {
    return this.roleService.updateRole(id, dto)
  }

  @ApiOperation({
    summary: '删除角色（v1）',
    description: '内置 admin 角色不可删；角色下仍有用户时拒绝（先解绑）；删除前自动清理菜单授权关联'
  })
  @OperLog('角色管理')
  @Perms('system:role:delete')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.roleService.deleteRole(id)
  }

  @ApiOperation({ summary: '查询角色已授权的菜单/按钮 id 列表（v1）', description: '授权弹窗勾选回显用，轻量只返回 id 数组' })
  @ApiOkResponse({ description: '已授权 id 数组', schema: { type: 'object', properties: { menuIds: { type: 'array', items: { type: 'string' } } } } })
  @Get(':id/menu-ids')
  async menuIds(@Param('id') id: string): Promise<{ menuIds: string[] }> {
    const role = await this.roleService.findOneWithMenus(id)
    return { menuIds: (role.permissions ?? []).map(menu => menu.id) }
  }

  @ApiOperation({ summary: '保存角色菜单/按钮授权（v1）', description: '全量覆盖：传入完整勾选 id 列表，空数组即清空' })
  @OperLog('角色管理')
  @Perms('system:role:update')
  @Put(':id/menus')
  async assignMenus(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    await this.roleService.assignMenus(id, dto.menuIds as string[])
    const role = await this.roleService.findOneWithMenus(id)
    return { menuIds: (role.permissions ?? []).map(menu => menu.id) }
  }
}
