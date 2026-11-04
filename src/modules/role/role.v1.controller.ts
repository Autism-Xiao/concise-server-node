import { Body, Controller, Get, Param, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Roles } from '../../common/decorators/roles.decorator'
import { UpdateRoleDto } from './dto/update-role.dto'
import { RoleService } from './role.service'

/**
 * 角色接口 V1：/api/v1/roles/**
 *
 * 版本策略：URL 前缀做版本。本控制器只挂「授权」相关入口，
 * 角色增删改查仍在旧路由 /api/roles，后续逐个迁移。
 */
@ApiTags('角色管理 V1')
@ApiBearerAuth('jwt')
@Roles('admin')
@Controller('v1/roles')
export class RoleV1Controller {
  constructor(private readonly roleService: RoleService) {}

  @ApiOperation({ summary: '查询角色已授权的菜单/按钮 id 列表（v1）', description: '授权弹窗勾选回显用，轻量只返回 id 数组' })
  @ApiOkResponse({ description: '已授权 id 数组', schema: { type: 'object', properties: { menuIds: { type: 'array', items: { type: 'string' } } } } })
  @Get(':id/menu-ids')
  async menuIds(@Param('id') id: string): Promise<{ menuIds: string[] }> {
    const role = await this.roleService.findOneWithMenus(id)
    return { menuIds: (role.permissions ?? []).map(menu => menu.id) }
  }

  @ApiOperation({ summary: '保存角色菜单/按钮授权（v1）', description: '全量覆盖：传入完整勾选 id 列表' })
  @Put(':id/menus')
  async assignMenus(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    await this.roleService.assignMenus(id, dto.menuIds as string[])
    const role = await this.roleService.findOneWithMenus(id)
    return { menuIds: (role.permissions ?? []).map(menu => menu.id) }
  }
}
