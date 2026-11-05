import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'

import { BatchDeleteDto } from '../../common/dto/batch-delete.dto'
import { Perms } from '../../common/decorators/perms.decorator'
import { OperLog } from '../../common/decorators/oper-log.decorator'
import { formatDateTime, parseCsv } from '../../utils/csv.util'
import { setDownloadHeaders } from '../../utils/download.util'
import { buildImportTemplateXlsx, buildXlsx, readXlsxTable } from '../../utils/xlsx.util'
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
@Controller('v1/roles')
export class RoleV1Controller {
  constructor(private readonly roleService: RoleService) {}

  @ApiOperation({ summary: '角色列表（v1）', description: '全量返回（角色数量少不分页），含已授权菜单；keyword 模糊匹配名称/编码；需 system:role:list' })
  @ApiOkResponse({ description: '角色列表', type: [RoleEntity] })
  @Perms('system:role:list')
  @Get()
  list(@Query() query: QueryRoleDto): Promise<RoleEntity[]> {
    return this.roleService.listByQuery(query)
  }

  @ApiOperation({
    summary: '角色下拉选项（v1）',
    description: '仅返回 id/角色名/角色编码，登录即可用；用户表单分配角色、用户列表角色筛选等跨模块下拉的数据源（不含授权明细）'
  })
  @ApiOkResponse({ description: '角色选项数组' })
  @Get('options')
  options(): Promise<Array<{ id: string; roleCode: string; roleName?: string }>> {
    return this.roleService.listOptions()
  }

  @ApiOperation({ summary: '导出角色 Excel（v1）', description: '与列表同过滤条件（keyword），不分页；返回 .xlsx，需 system:role:export 权限' })
  @Perms('system:role:export')
  @Get('export')
  async export(@Query() query: QueryRoleDto, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const roles = await this.roleService.exportRoles(query)
    const buffer = await buildXlsx(
      '角色',
      [
        { header: '角色名称', width: 20 },
        { header: '角色编码', width: 24 },
        { header: '描述', width: 36 },
        { header: '已授权菜单数', width: 14 },
        { header: '创建时间', width: 22 }
      ],
      roles.map(role => [role.roleName ?? '', role.roleCode, role.description ?? '', role.permissions?.length ?? 0, formatDateTime(role.createTime)]),
      {
        title: '角色列表',
        subtitle: `导出时间：${formatDateTime(new Date())} · 共 ${roles.length} 条记录`,
        notes: ['说明：已授权菜单数包含目录、菜单与按钮；角色编码全局唯一，用于接口权限匹配。']
      }
    )
    setDownloadHeaders(res, `roles-${Date.now()}.xlsx`, `角色列表-${formatDateTime(new Date()).slice(0, 10)}.xlsx`)
    return new StreamableFile(buffer)
  }

  @ApiOperation({
    summary: '下载角色导入模板 Excel（v1）',
    description: '首个工作表为填写说明 + 表头（角色编码为必填，带 * 与批注），第二个工作表为填写示例；需 system:role:import'
  })
  @Perms('system:role:import')
  @Get('import-template')
  async downloadTemplate(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const buffer = await buildImportTemplateXlsx({
      sheetName: '角色导入',
      title: '角色导入模板',
      notes: [
        '填写说明（请从「角色导入」这张表的表头下方开始填写，不要改动表头；示例见第二张表）：',
        '1. 带 * 的列为必填；「角色编码」已存在时更新该角色，不存在则新增。',
        '2. 角色编码：字母开头，只能包含字母/数字/下划线/冒号/点/短横线，全局唯一，用于接口权限匹配。',
        '3. 更新已有角色时只覆盖名称与描述，已授权菜单不受影响；描述留空表示不修改。',
        '4. 导入不会绑定菜单权限，导入完成后请到角色管理页逐条配置授权。'
      ],
      columns: [
        { header: '角色名称', width: 20, hint: '留空时默认与角色编码相同' },
        { header: '角色编码', width: 24, required: true, hint: '字母开头，全局唯一；已存在则更新该角色' },
        { header: '描述', width: 40, hint: '留空表示不修改（新建时为空）' }
      ],
      samples: [
        ['运营专员', 'operator', '负责日常运营，仅可查看数据'],
        ['财务审核', 'finance_auditor', '']
      ]
    })
    setDownloadHeaders(res, 'roles-import-template.xlsx', '角色导入模板.xlsx')
    return new StreamableFile(buffer)
  }

  @ApiOperation({
    summary: '导入角色 Excel（v1）',
    description:
      'multipart/form-data，字段名 file；支持 .xlsx（推荐）与 .csv；按角色编码判定新增/更新（已存在只覆盖名称与描述，不动菜单授权）；单行失败不影响其他行'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary', description: 'Excel 文件（.xlsx，≤5MB，≤2000 行）；兼容 .csv（UTF-8）' } },
      required: ['file']
    }
  })
  @OperLog('角色管理')
  @Perms('system:role:import')
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ROLE_IMPORT_MAX_SIZE } }))
  async import(@UploadedFile() file?: Express.Multer.File): Promise<RoleImportResult> {
    if (!file) {
      throw new BadRequestException('未接收到文件，请选择 Excel 后重试')
    }
    const filename = file.originalname ?? ''
    if (/\.xlsx$/i.test(filename)) {
      // 模板头部有大标题与填写说明，按表头关键字定位，避免把标题当列名/把说明当数据
      const table = await readXlsxTable(file.buffer, { headerKeys: ['角色编码', '权限字符', 'roleCode'] })
      return this.roleService.importRoles(table.rows, table.headerRow)
    }
    if (/\.csv$/i.test(filename)) {
      const text = file.buffer.toString('utf8')
      // utf8 解码失败会产生替换字符，明确报错比入库乱码好排查
      if (text.includes('\uFFFD')) {
        throw new BadRequestException('CSV 文件编码不是 UTF-8，请改用 .xlsx 导入，或另存为「CSV UTF-8（逗号分隔）」')
      }
      return this.roleService.importRoles(parseCsv(text), 1)
    }
    throw new BadRequestException('仅支持 .xlsx（推荐）或 .csv 文件')
  }

  @ApiOperation({ summary: '角色详情（v1，含已授权菜单）', description: '需 system:role:list' })
  @ApiOkResponse({ description: '角色信息', type: RoleEntity })
  @Perms('system:role:list')
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

  @ApiOperation({ summary: '批量删除角色（v1）', description: '单次最多 200 条；内置角色或有用户的角色该条失败并返回原因；需 system:role:delete' })
  @OperLog('角色管理')
  @Perms('system:role:delete')
  @Post('batch-delete')
  batchDelete(@Body() dto: BatchDeleteDto) {
    return this.roleService.batchDelete(dto.ids)
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

  @ApiOperation({
    summary: '查询角色已授权的菜单/按钮 id 列表（v1）',
    description: '授权弹窗勾选回显用；内置超级管理员返回全部菜单 id（其权限为内置全量）'
  })
  @ApiOkResponse({ description: '已授权 id 数组', schema: { type: 'object', properties: { menuIds: { type: 'array', items: { type: 'string' } } } } })
  @Perms('system:role:list')
  @Get(':id/menu-ids')
  async menuIds(@Param('id') id: string): Promise<{ menuIds: string[] }> {
    return { menuIds: await this.roleService.getMenuIds(id) }
  }

  @ApiOperation({
    summary: '保存角色菜单/按钮授权（v1）',
    description: '全量覆盖：传入完整勾选 id 列表，空数组即清空；内置超级管理员角色拒绝写入（400）'
  })
  @OperLog('角色管理')
  @Perms('system:role:update')
  @Put(':id/menus')
  async assignMenus(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    await this.roleService.assignMenus(id, dto.menuIds as string[])
    return { menuIds: await this.roleService.getMenuIds(id) }
  }
}
