import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { CreateDictDto } from './dto/create-dict.dto'
import { QueryDictDto } from './dto/query-dict.dto'
import { UpdateDictDto } from './dto/update-dict.dto'
import { DictService } from './dict.service'
import { SysDictEntity } from './entities/sys-dict.entity'

/**
 * 数据字典接口 V1：/api/v1/dicts
 *
 * 表对齐 JeecgBoot sys_dict；删除是软删（del_flag=1），字典下还有字典项时拒绝删除。
 */
@ApiTags('数据字典 V1')
@ApiBearerAuth('jwt')
@Roles('admin')
@Controller('v1/dicts')
export class DictV1Controller {
  constructor(private readonly dictService: DictService) {}

  @ApiOperation({ summary: '字典列表（v1）', description: '字典类型数量少，一次全量返回不分页；keyword 模糊匹配名称/编码；每项带 itemCount' })
  @ApiOkResponse({ description: '字典列表', type: [SysDictEntity] })
  @Perms('system:dict:list')
  @Get()
  list(@Query() query: QueryDictDto) {
    return this.dictService.listByQuery(query)
  }

  @ApiOperation({ summary: '字典详情（v1）' })
  @Perms('system:dict:list')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.dictService.findDetail(id)
  }

  @ApiOperation({ summary: '创建字典（v1）', description: 'dictCode 全局唯一（字母开头，可含数字/下划线/冒号/点/短横线）' })
  @OperLog('数据字典')
  @Perms('system:dict:add')
  @Post()
  create(@Body() dto: CreateDictDto, @Request() req: { user: { username: string } }) {
    return this.dictService.createDict(dto, req.user?.username)
  }

  @ApiOperation({ summary: '更新字典（v1）', description: '改 dictCode 时重新校验唯一性' })
  @OperLog('数据字典')
  @Perms('system:dict:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDictDto, @Request() req: { user: { username: string } }) {
    return this.dictService.updateDict(id, dto, req.user?.username)
  }

  @ApiOperation({ summary: '删除字典（v1）', description: '软删（del_flag=1）；字典下存在字典项时拒绝' })
  @OperLog('数据字典')
  @Perms('system:dict:delete')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.dictService.deleteDict(id)
    return { deleted: 1 }
  }
}
