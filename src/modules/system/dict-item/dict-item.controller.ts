import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator'

import { Perms } from '../../../common/decorators/perms.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { PagerDto } from '../../../common/dto/pager.dto'
import { DictItemEntity } from './entities/dict-item.entity'
import { CreateDictItemDto } from './dto/create-dict-item.dto'
import { UpdateDictItemDto } from './dto/update-dict-item.dto'
import { DictItemService } from './dict-item.service'

class QueryDictItemDto extends PagerDto {
  @ApiPropertyOptional({ description: '所属字典类型 ID', example: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  dictTypeId?: number

  @ApiPropertyOptional({ description: '关键字：模糊匹配标签/值', example: '男' })
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

@ApiTags('字典项')
@ApiBearerAuth('jwt')
@Controller('dict-items')
export class DictItemController {
  constructor(private readonly dictItemService: DictItemService) {}

  /** 按编码取字典项：所有登录用户可用（下拉框数据源），放在 /code/:code 避免与 :id 冲突 */
  @ApiOperation({ summary: '按字典编码取启用字典项', description: '所有登录用户可用，前端下拉框数据源' })
  @Get('code/:code')
  listByCode(@Param('code') code: string) {
    return this.dictItemService.listByTypeCode(code)
  }

  @ApiOperation({ summary: '字典项分页列表' })
  @ApiOkResponse({ description: '分页结果', type: [DictItemEntity] })
  @Roles('admin')
  @Get()
  list(@Query() query: QueryDictItemDto) {
    return this.dictItemService.listByQuery(query)
  }

  @ApiOperation({ summary: '字典项详情' })
  @Roles('admin')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.dictItemService.findOne(id)
  }

  @ApiOperation({ summary: '创建字典项' })
  @Roles('admin')
  @OperLog('字典项')
  @Perms('system:dict:add')
  @Post()
  create(@Body() dto: CreateDictItemDto) {
    return this.dictItemService.create(dto)
  }

  @ApiOperation({ summary: '更新字典项' })
  @Roles('admin')
  @OperLog('字典项')
  @Perms('system:dict:update')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDictItemDto) {
    return this.dictItemService.update(id, dto)
  }

  @ApiOperation({ summary: '删除字典项' })
  @Roles('admin')
  @OperLog('字典项')
  @Perms('system:dict:delete')
  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.dictItemService.delete(id)
  }
}
