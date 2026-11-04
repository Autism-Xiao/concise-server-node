import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'

import { Roles } from '../../common/decorators/roles.decorator'
import { Perms } from '../../common/decorators/perms.decorator'
import { OperLog } from '../../common/decorators/oper-log.decorator'
import { formatDateTime, toCsv } from '../../utils/csv.util'
import { CreateRoleDto } from './dto/create-role.dto'
import { QueryRoleDto } from './dto/query-role.dto'
import { UpdateRoleDto } from './dto/update-role.dto'
import { RoleEntity } from './entities/role.entity'
import { ROLE_IMPORT_MAX_SIZE, RoleService, type RoleImportResult } from './role.service'

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

  @ApiOperation({ summary: '导出角色 CSV（v1）', description: '与列表同过滤条件（keyword），不分页；需 system:role:export 权限' })
  @Perms('system:role:export')
  @Get('export')
  async export(@Query() query: QueryRoleDto, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const roles = await this.roleService.exportRoles(query)
    const csv = toCsv(
      ['角色名称', '角色编码', '描述', '已授权菜单数', '创建时间'],
      roles.map(role => [role.roleName ?? '', role.roleCode, role.description ?? '', role.permissions?.length ?? 0, formatDateTime(role.createTime)])
    )
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="roles-${Date.now()}.csv"`)
    return new StreamableFile(Buffer.from(csv, 'utf8'))
  }

  @ApiOperation({ summary: '下载角色导入模板 CSV（v1）', description: '仅表头 + 一行示例，UTF-8 BOM，Excel 可直接打开填写；需 system:role:import 权限' })
  @Perms('system:role:import')
  @Get('import-template')
  downloadTemplate(@Res({ passthrough: true }) res: Response): StreamableFile {
    const csv = toCsv(
      ['角色名称', '角色编码', '描述'],
      [
        ['运营专员', 'operator', '负责日常运营，仅可查看数据'],
        ['财务审核', 'finance_auditor', '']
      ]
    )
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="roles-import-template.csv"')
    return new StreamableFile(Buffer.from(csv, 'utf8'))
  }

  @ApiOperation({
    summary: '导入角色 CSV（v1）',
    description: 'multipart/form-data，字段名 file；按角色编码判定新增/更新（已存在的只覆盖名称与描述，不动菜单授权）；单行失败不影响其他行'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary', description: 'CSV 文件（UTF-8，≤2MB，≤2000 行）' } },
      required: ['file']
    }
  })
  @OperLog('角色管理')
  @Perms('system:role:import')
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ROLE_IMPORT_MAX_SIZE } }))
  import(@UploadedFile() file?: Express.Multer.File): Promise<RoleImportResult> {
    if (!file) {
      throw new BadRequestException('未接收到文件，请选择 CSV 后重试')
    }
    if (!/\.csv$/i.test(file.originalname ?? '')) {
      throw new BadRequestException('仅支持 CSV 文件，请用 Excel 另存为「CSV UTF-8（逗号分隔）」')
    }
    return this.roleService.importRoles(file.buffer.toString('utf8'))
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
