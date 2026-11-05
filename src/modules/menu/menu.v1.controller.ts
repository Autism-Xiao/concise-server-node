import { Body, Controller, Delete, Get, Param, Post, Put, Request, Res, StreamableFile } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'

import { OperLog } from '../../common/decorators/oper-log.decorator'
import { Perms } from '../../common/decorators/perms.decorator'
import { formatDateTime } from '../../utils/csv.util'
import { setDownloadHeaders } from '../../utils/download.util'
import { buildXlsx } from '../../utils/xlsx.util'
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
@Controller('v1/menus')
export class MenuV1Controller {
  constructor(private readonly menuService: MenuService) {}

  @ApiOperation({
    summary: '菜单树（v1）',
    description: '目录/菜单/按钮三级结构；角色授权弹窗、登录权限接口共用，属登录可用元数据（不校验菜单权限）'
  })
  @Get('tree')
  tree() {
    return this.menuService.getTree()
  }

  @ApiOperation({ summary: '菜单全量列表（v1，扁平，排除已删除）', description: '需 system:menu:list' })
  @ApiOkResponse({ description: '菜单列表', type: [MenuEntity] })
  @Perms('system:menu:list')
  @Get()
  list() {
    return this.menuService.listAll()
  }

  @ApiOperation({
    summary: '导出菜单权限快照 Excel（v1）',
    description: '扁平导出全部菜单（含按钮权限）并带上级菜单名，用于权限留档与环境比对；只导出不导入；需 system:menu:export'
  })
  @Perms('system:menu:export')
  @Get('export')
  async export(@Request() req: { user: { username: string } }, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const menus = await this.menuService.listAll()
    const byId = new Map(menus.map(menu => [menu.id, menu]))
    const typeText = (type: number) => (type === 0 ? '目录' : type === 1 ? '菜单' : '按钮')
    const buffer = await buildXlsx(
      '菜单权限',
      [
        { header: '菜单名称', width: 22 },
        { header: '类型', width: 8, align: 'center' },
        { header: '上级菜单', width: 22 },
        { header: '路由地址', width: 28 },
        { header: '权限标识', width: 28 },
        { header: '排序', width: 8, align: 'center' },
        { header: '状态', width: 10, align: 'center' },
        { header: '图标', width: 18 }
      ],
      menus.map(menu => [
        menu.name,
        typeText(menu.menuType),
        menu.parentId ? (byId.get(menu.parentId)?.name ?? '') : '',
        menu.url ?? '',
        menu.perms ?? '',
        menu.sortNo ?? 0,
        menu.status === '0' ? '停用' : '正常',
        menu.icon ?? ''
      ]),
      {
        title: '菜单权限快照',
        subtitle: `导出时间：${formatDateTime(new Date())} · 操作人：${req.user?.username ?? '未知'} · 共 ${menus.length} 条记录`,
        notes: [
          '说明：本文件用于权限留档与跨环境比对，不支持导回（菜单主键与父级关系跨库无法对应）。',
          '「权限标识」与后端接口的 @Perms 声明一一对应，新增接口时应同步在菜单表补按钮权限。'
        ]
      }
    )
    setDownloadHeaders(res, `menus-${Date.now()}.xlsx`, `菜单权限快照-${formatDateTime(new Date()).slice(0, 10)}.xlsx`)
    return new StreamableFile(buffer)
  }

  @ApiOperation({ summary: '菜单详情（v1）', description: '需 system:menu:list' })
  @Perms('system:menu:list')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.menuService.findOne(id)
  }

  @ApiOperation({ summary: '创建菜单（v1）', description: '支持目录/菜单/按钮三种类型；父级必须存在' })
  @OperLog('菜单管理')
  @Perms('system:menu:add')
  @Post()
  create(@Body() dto: CreateMenuDto) {
    return this.menuService.create(dto)
  }

  @ApiOperation({ summary: '更新菜单（v1）', description: '换父级时校验父级存在且不形成循环层级' })
  @OperLog('菜单管理')
  @Perms('system:menu:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMenuDto) {
    return this.menuService.update(id, dto)
  }

  @ApiOperation({ summary: '删除菜单（v1）', description: '软删除（del_flag=1）；存在子菜单时拒绝，需先删子级' })
  @OperLog('菜单管理')
  @Perms('system:menu:delete')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.menuService.delete(id)
  }
}
