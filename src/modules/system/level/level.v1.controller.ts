import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
import { CreateLevelDto } from './dto/create-level.dto'
import { QueryLevelDto } from './dto/query-level.dto'
import { UpdateLevelDto } from './dto/update-level.dto'
import { LevelEntity } from './entities/level.entity'
import { LevelService } from './level.service'

/**
 * 职级管理接口 V1：/api/v1/levels/**
 *
 * 版本策略：URL 前缀做版本，新模块直接只挂 v1 路由。
 */
@ApiTags('职级管理 V1')
@ApiBearerAuth('jwt')
@Controller('v1/levels')
export class LevelV1Controller {
  constructor(private readonly levelService: LevelService) {}

  @ApiOperation({ summary: '职级列表（v1）', description: 'level_rank 降序（级别从高到低）；keyword 模糊匹配名称/备注；需 system:level:list' })
  @ApiOkResponse({ description: '职级列表', type: [LevelEntity] })
  @Perms('system:level:list')
  @Get()
  list(@Query() query: QueryLevelDto): Promise<LevelEntity[]> {
    return this.levelService.listByQuery(query)
  }

  @ApiOperation({ summary: '职级详情（v1）', description: '需 system:level:list' })
  @ApiOkResponse({ description: '职级信息', type: LevelEntity })
  @Perms('system:level:list')
  @Get(':id')
  findOne(@Param('id') id: string): Promise<LevelEntity> {
    return this.levelService.findOne(id)
  }

  @ApiOperation({ summary: '创建职级（v1）', description: 'levelName 唯一' })
  @OperLog('职级管理')
  @Perms('system:level:add')
  @Post()
  create(@Body() dto: CreateLevelDto, @Request() req: { user: { username: string } }): Promise<LevelEntity> {
    return this.levelService.createLevel(dto, req.user.username)
  }

  @ApiOperation({ summary: '更新职级（v1）', description: '改名时校验唯一' })
  @OperLog('职级管理')
  @Perms('system:level:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLevelDto, @Request() req: { user: { username: string } }): Promise<LevelEntity> {
    return this.levelService.updateLevel(id, dto, req.user.username)
  }

  @ApiOperation({ summary: '删除职级（v1）', description: '硬删除，职级暂无关联数据' })
  @OperLog('职级管理')
  @Perms('system:level:delete')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.levelService.delete(id)
  }
}
