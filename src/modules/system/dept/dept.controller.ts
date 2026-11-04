import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Perms } from '../../../common/decorators/perms.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { DeptEntity } from './entities/dept.entity'
import { CreateDeptDto } from './dto/create-dept.dto'
import { UpdateDeptDto } from './dto/update-dept.dto'
import { DeptService } from './dept.service'

@ApiTags('部门管理')
@ApiBearerAuth('jwt')
@Roles('admin')
@Controller('depts')
export class DeptController {
  constructor(private readonly deptService: DeptService) {}

  @ApiOperation({ summary: '部门树' })
  @ApiOkResponse({ description: '部门树形结构', type: [DeptEntity] })
  @Get('tree')
  tree() {
    return this.deptService.getTree()
  }

  @ApiOperation({ summary: '部门全量列表（扁平，排除已删除）' })
  @Get()
  list() {
    return this.deptService.listAll()
  }

  @ApiOperation({ summary: '部门详情' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.deptService.findOne(id)
  }

  @ApiOperation({ summary: '创建部门', description: 'orgCode 不传则按层级自动生成' })
  @OperLog('部门管理')
  @Perms('system:dept:add')
  @Post()
  create(@Body() dto: CreateDeptDto) {
    return this.deptService.create(dto)
  }

  @ApiOperation({ summary: '更新部门' })
  @OperLog('部门管理')
  @Perms('system:dept:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDeptDto) {
    return this.deptService.update(id, dto)
  }

  @ApiOperation({ summary: '删除部门（软删）' })
  @OperLog('部门管理')
  @Perms('system:dept:delete')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.deptService.delete(id)
  }
}
