import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

import { Perms } from '../../../common/decorators/perms.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { PagerDto } from '../../../common/dto/pager.dto'
import { DictTypeEntity } from './entities/dict-type.entity'
import { CreateDictTypeDto } from './dto/create-dict-type.dto'
import { UpdateDictTypeDto } from './dto/update-dict-type.dto'
import { DictTypeService } from './dict-type.service'

class QueryDictTypeDto extends PagerDto {
  @ApiPropertyOptional({ description: '关键字：模糊匹配名称/编码', example: 'gender' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  keyword?: string

  @ApiPropertyOptional({ description: '状态过滤：0 禁用 / 1 启用', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsIn([0, 1])
  @Type(() => Number)
  status?: number
}

@ApiTags('字典类型')
@ApiBearerAuth('jwt')
@Roles('admin')
@Controller('dict-types')
export class DictTypeController {
  constructor(private readonly dictTypeService: DictTypeService) {}

  @ApiOperation({ summary: '字典类型分页列表' })
  @ApiOkResponse({ description: '分页结果', type: [DictTypeEntity] })
  @Get()
  list(@Query() query: QueryDictTypeDto) {
    return this.dictTypeService.listByQuery(query)
  }

  @ApiOperation({ summary: '字典类型详情' })
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.dictTypeService.findOne(id)
  }

  @ApiOperation({ summary: '创建字典类型' })
  @OperLog('字典类型')
  @Perms('system:dict:add')
  @Post()
  create(@Body() dto: CreateDictTypeDto) {
    return this.dictTypeService.create(dto)
  }

  @ApiOperation({ summary: '更新字典类型' })
  @OperLog('字典类型')
  @Perms('system:dict:update')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDictTypeDto) {
    return this.dictTypeService.update(id, dto)
  }

  @ApiOperation({ summary: '删除字典类型（下有字典项时拒绝）' })
  @OperLog('字典类型')
  @Perms('system:dict:delete')
  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.dictTypeService.delete(id)
  }
}
