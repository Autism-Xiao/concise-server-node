import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
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

  @ApiOperation({ summary: '删除部门（v1，软删除）', description: '存在子部门或挂有未删除用户时拒绝，需先处理下级与用户' })
  @OperLog('部门管理')
  @Perms('system:dept:delete')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.deptService.delete(id)
  }
}
