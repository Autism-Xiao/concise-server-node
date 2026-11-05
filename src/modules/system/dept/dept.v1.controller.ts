import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request, Res, StreamableFile } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'

import { BatchDeleteDto } from '../../../common/dto/batch-delete.dto'
import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
import { formatDateTime } from '../../../utils/csv.util'
import { setDownloadHeaders } from '../../../utils/download.util'
import { buildXlsx } from '../../../utils/xlsx.util'
import { CreateDeptDto } from './dto/create-dept.dto'
import { UpdateDeptDto } from './dto/update-dept.dto'
import { DeptEntity } from './entities/dept.entity'
import { DeptService } from './dept.service'

/**
 * 部门管理接口 V1：/api/v1/depts/**
 *
 * 版本策略：URL 前缀做版本，老版本路由（/api/depts/**）继续保留兼容；
 * 前端用户表单的部门数据源已在用旧路由，待全部迁移后统一下线。
 */
@ApiTags('部门管理 V1')
@ApiBearerAuth('jwt')
@Controller('v1/depts')
export class DeptV1Controller {
  constructor(private readonly deptService: DeptService) {}

  @ApiOperation({
    summary: '部门树（v1）',
    description: '排除已删除，children 递归组装；用户表单/用户列表筛选与部门管理页共用，属登录可用元数据（不校验部门权限）'
  })
  @ApiOkResponse({ description: '部门树形结构', type: [DeptEntity] })
  @Get('tree')
  tree() {
    return this.deptService.getTree()
  }

  @ApiOperation({ summary: '部门全量列表（v1，扁平，排除已删除）', description: '支持 keyword 模糊匹配部门名称' })
  @ApiOkResponse({ description: '部门列表', type: [DeptEntity] })
  @Perms('system:dept:list')
  @Get()
  list(@Query() query: { keyword?: string }) {
    const keyword = query.keyword?.trim()
    if (!keyword) {
      return this.deptService.listAll()
    }
    return this.deptService.listAll().then(all => all.filter(dept => (dept.departName ?? '').includes(keyword)))
  }

  @ApiOperation({ summary: '导出部门 Excel（v1）', description: '与列表同筛选条件（keyword），带「完整路径」列，便于组织架构留档；需 system:dept:export' })
  @Perms('system:dept:export')
  @Get('export')
  async export(
    @Query() query: { keyword?: string },
    @Request() req: { user: { username: string } },
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const depts = await this.deptService.exportDepts(query.keyword?.trim())
    const buffer = await buildXlsx(
      '部门列表',
      [
        { header: '部门名称', width: 22 },
        { header: '完整路径', width: 40 },
        { header: '机构编码', width: 16, align: 'center' },
        { header: '部门负责人', width: 16 },
        { header: '联系电话', width: 16 },
        { header: '排序', width: 8, align: 'center' },
        { header: '状态', width: 10, align: 'center' },
        { header: '创建时间', width: 20, align: 'center' }
      ],
      depts.map(dept => [
        dept.departName,
        dept.fullPath,
        dept.orgCode ?? '',
        dept.description ?? '',
        dept.mobile ?? '',
        dept.departOrder ?? 0,
        dept.status === '0' ? '停用' : '正常',
        formatDateTime(dept.createTime)
      ]),
      {
        title: '部门列表',
        subtitle: `导出时间：${formatDateTime(new Date())} · 操作人：${req.user?.username ?? '未知'} · 共 ${depts.length} 个部门${query.keyword ? ` · 筛选：关键字=${query.keyword}` : ''}`,
        notes: ['说明：「完整路径」为该部门从顶级到自身的层级链路；机构编码由系统按父子关系生成，导入用户时按部门名称匹配。']
      }
    )
    setDownloadHeaders(res, `depts-${Date.now()}.xlsx`, `部门列表-${formatDateTime(new Date()).slice(0, 10)}.xlsx`)
    return new StreamableFile(buffer)
  }

  @ApiOperation({ summary: '部门详情（v1）', description: '需 system:dept:list' })
  @ApiOkResponse({ description: '部门信息', type: DeptEntity })
  @Perms('system:dept:list')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.deptService.findOne(id)
  }

  @ApiOperation({ summary: '创建部门（v1）', description: '父级必须存在；orgCode 不传则按层级自动生成（如 A01 / A01A01）' })
  @OperLog('部门管理')
  @Perms('system:dept:add')
  @Post()
  create(@Body() dto: CreateDeptDto) {
    return this.deptService.create(dto)
  }

  @ApiOperation({ summary: '更新部门（v1）', description: '换父级时防环（不能是自己或自己的后代）；orgCode 变更会同步刷新挂靠用户的 org_code' })
  @OperLog('部门管理')
  @Perms('system:dept:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDeptDto) {
    return this.deptService.update(id, dto)
  }

  @ApiOperation({ summary: '批量删除部门（v1）', description: '单次最多 200 条；有子部门或挂有用户的该条失败并返回原因；需 system:dept:delete' })
  @OperLog('部门管理')
  @Perms('system:dept:delete')
  @Post('batch-delete')
  batchDelete(@Body() dto: BatchDeleteDto) {
    return this.deptService.batchDelete(dto.ids)
  }

  @ApiOperation({ summary: '删除部门（v1，软删除）', description: '存在子部门或挂有未删除用户时拒绝，需先处理下级与用户' })
  @OperLog('部门管理')
  @Perms('system:dept:delete')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.deptService.delete(id)
  }
}
