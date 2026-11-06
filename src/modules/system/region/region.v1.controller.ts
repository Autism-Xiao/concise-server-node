import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
import { Pagination } from '../../../helper/paginate'
import { CreateRegionDto } from './dto/create-region.dto'
import { ImportRegionDto } from './dto/import-region.dto'
import { UpdateRegionDto } from './dto/update-region.dto'
import { RegionEntity } from './entities/region.entity'
import { RegionService } from './region.service'

/**
 * 行政区划接口 V1：/api/v1/regions/**
 *
 * 数据结构以「区划代码」为关联键（areaCode / parentCode），层级 0省/1市/2区县/3街道。
 * tree / children / code 属登录可用的元数据（前端级联选择器到处用，不校验按钮权限）；
 * 增删改/导入需在菜单管理里给角色勾选 system:region:* 权限。
 */
@ApiTags('行政区划 V1')
@ApiBearerAuth('jwt')
@Controller('v1/regions')
export class RegionV1Controller {
  constructor(private readonly regionService: RegionService) {}

  @ApiOperation({ summary: '区划树（v1）', description: '全量内存组装；登录即可访问，供级联选择器/区划管理页共用' })
  @ApiOkResponse({ description: '区划树形结构', type: [RegionEntity] })
  @Get('tree')
  tree() {
    return this.regionService.getTree()
  }

  @ApiOperation({ summary: '区划列表（v1，分页）', description: 'keyword 模糊匹配名称/简称/拼音/区划代码；level、parentCode 精确过滤；需 system:region:list' })
  @ApiOkResponse({ description: '区划分页列表', type: Pagination })
  @Perms('system:region:list')
  @Get()
  async list(@Query() query: { keyword?: string; level?: string; parentCode?: string }): Promise<Pagination<RegionEntity>> {
    const level = query.level === undefined || query.level === '' ? undefined : Number(query.level)
    return this.regionService.listByQuery({
      keyword: query.keyword,
      level: level !== undefined && Number.isFinite(level) ? level : undefined,
      parentCode: query.parentCode
    })
  }

  @ApiOperation({ summary: '按上级查子级（v1）', description: 'parentCode="0" 查全部省级；登录即可访问，级联选择器懒加载用' })
  @ApiOkResponse({ description: '直接子级区划列表', type: [RegionEntity] })
  @Get('children/:parentCode')
  children(@Param('parentCode') parentCode: string) {
    return this.regionService.listChildren(parentCode)
  }

  @ApiOperation({ summary: '按区划代码查详情（v1）', description: '登录即可访问' })
  @ApiOkResponse({ description: '区划信息', type: RegionEntity })
  @Get('code/:areaCode')
  findByCode(@Param('areaCode') areaCode: string) {
    return this.regionService.findByAreaCode(areaCode)
  }

  @ApiOperation({ summary: '区划详情（v1）', description: '需 system:region:list' })
  @ApiOkResponse({ description: '区划信息', type: RegionEntity })
  @Perms('system:region:list')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.regionService.findOne(id)
  }

  @ApiOperation({ summary: '创建区划（v1）', description: '父级必须存在；areaCode 全局唯一；levelText 由 level 推导；需 system:region:add' })
  @OperLog('行政区划')
  @Perms('system:region:add')
  @Post()
  create(@Body() dto: CreateRegionDto) {
    return this.regionService.create(dto)
  }

  @ApiOperation({ summary: '批量导入区划（v1）', description: '按 areaCode upsert（存在更新/不存在插入），单次最多 5000 条；需 system:region:import' })
  @OperLog('行政区划')
  @Perms('system:region:import')
  @Post('import')
  import(@Body() dto: ImportRegionDto) {
    return this.regionService.importRegions(dto)
  }

  @ApiOperation({ summary: '更新区划（v1）', description: '换上级防环（不能是自己或自己的后代）；levelText 随 level 自动刷新；需 system:region:update' })
  @OperLog('行政区划')
  @Perms('system:region:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRegionDto) {
    return this.regionService.update(id, dto)
  }

  @ApiOperation({ summary: '删除区划（v1）', description: '存在下级区划时拒绝；需 system:region:delete' })
  @OperLog('行政区划')
  @Perms('system:region:delete')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.regionService.delete(id)
  }
}
