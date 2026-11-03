import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

import { Perms } from '../../../common/decorators/perms.decorator'
import { Roles } from '../../../common/decorators/roles.decorator'
import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { PagerDto } from '../../../common/dto/pager.dto'
import { NoticeEntity } from './entities/notice.entity'
import { CreateNoticeDto } from './dto/create-notice.dto'
import { UpdateNoticeDto } from './dto/update-notice.dto'
import { NoticeService } from './notice.service'

class QueryNoticeDto extends PagerDto {
  @ApiPropertyOptional({ description: '标题模糊过滤', example: '上线' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  keyword?: string

  @ApiPropertyOptional({ description: '类型过滤：1 通知 / 2 公告', example: 1, enum: [1, 2] })
  @IsOptional()
  @IsIn([1, 2])
  @Type(() => Number)
  type?: number

  @ApiPropertyOptional({ description: '状态过滤：0 草稿 / 1 已发布', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsIn([0, 1])
  @Type(() => Number)
  status?: number
}

class QueryPublishedNoticeDto extends PagerDto {
  @ApiPropertyOptional({ description: '类型过滤：1 通知 / 2 公告', example: 1, enum: [1, 2] })
  @IsOptional()
  @IsIn([1, 2])
  @Type(() => Number)
  type?: number
}

@ApiTags('公告管理')
@ApiBearerAuth('jwt')
@Controller('notices')
export class NoticeController {
  constructor(private readonly noticeService: NoticeService) {}

  /** 普通用户端：仅已发布 */
  @ApiOperation({ summary: '已发布公告列表（所有登录用户）', description: '按发布时间倒序，仅返回已发布' })
  @ApiOkResponse({ description: '分页结果', type: [NoticeEntity] })
  @Get('published')
  listPublished(@Query() query: QueryPublishedNoticeDto) {
    return this.noticeService.listPublished(query)
  }

  /** 管理端 */
  @ApiOperation({ summary: '公告分页列表（管理端，含草稿）' })
  @Roles('admin')
  @Perms('system:notice:list')
  @Get()
  list(@Query() query: QueryNoticeDto) {
    return this.noticeService.listByQuery(query)
  }

  @ApiOperation({ summary: '公告详情' })
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.noticeService.findOne(id)
  }

  @ApiOperation({ summary: '创建公告（status=1 直接发布）' })
  @Roles('admin')
  @OperLog('公告管理')
  @Perms('system:notice:add')
  @Post()
  create(@Body() dto: CreateNoticeDto) {
    return this.noticeService.create(dto)
  }

  @ApiOperation({ summary: '更新公告' })
  @Roles('admin')
  @OperLog('公告管理')
  @Perms('system:notice:update')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateNoticeDto) {
    return this.noticeService.update(id, dto)
  }

  @ApiOperation({ summary: '发布公告' })
  @Roles('admin')
  @OperLog('公告管理')
  @Perms('system:notice:publish')
  @Put(':id/publish')
  publish(@Param('id', ParseIntPipe) id: number) {
    return this.noticeService.publish(id)
  }

  @ApiOperation({ summary: '撤回公告（回草稿）' })
  @Roles('admin')
  @OperLog('公告管理')
  @Perms('system:notice:publish')
  @Put(':id/unpublish')
  unpublish(@Param('id', ParseIntPipe) id: number) {
    return this.noticeService.unpublish(id)
  }

  @ApiOperation({ summary: '删除公告' })
  @Roles('admin')
  @OperLog('公告管理')
  @Perms('system:notice:delete')
  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.noticeService.delete(id)
  }
}
