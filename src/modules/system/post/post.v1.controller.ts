import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
import { CreatePostDto } from './dto/create-post.dto'
import { QueryPostDto } from './dto/query-post.dto'
import { UpdatePostDto } from './dto/update-post.dto'
import { PostEntity } from './entities/post.entity'
import { PostService } from './post.service'

/**
 * 岗位管理接口 V1：/api/v1/posts/**
 *
 * 版本策略：URL 前缀做版本，新模块直接只挂 v1 路由。
 */
@ApiTags('岗位管理 V1')
@ApiBearerAuth('jwt')
@Controller('v1/posts')
export class PostV1Controller {
  constructor(private readonly postService: PostService) {}

  @ApiOperation({ summary: '岗位列表（v1）', description: 'post_sort 升序，带所属部门；keyword 模糊匹配名称/编码/描述；支持 deptId 过滤；需 system:post:list' })
  @ApiOkResponse({ description: '岗位列表', type: [PostEntity] })
  @Perms('system:post:list')
  @Get()
  list(@Query() query: QueryPostDto): Promise<PostEntity[]> {
    return this.postService.listByQuery(query)
  }

  @ApiOperation({ summary: '岗位详情（v1）', description: '需 system:post:list' })
  @ApiOkResponse({ description: '岗位信息', type: PostEntity })
  @Perms('system:post:list')
  @Get(':id')
  findOne(@Param('id') id: string): Promise<PostEntity> {
    return this.postService.findOne(id)
  }

  @ApiOperation({ summary: '创建岗位（v1）', description: 'postCode 唯一；deptId 传入时必须存在且未删除' })
  @OperLog('岗位管理')
  @Perms('system:post:add')
  @Post()
  create(@Body() dto: CreatePostDto, @Request() req: { user: { username: string } }): Promise<PostEntity> {
    return this.postService.createPost(dto, req.user.username)
  }

  @ApiOperation({ summary: '更新岗位（v1）', description: '改编码校验唯一、换部门校验存在' })
  @OperLog('岗位管理')
  @Perms('system:post:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePostDto, @Request() req: { user: { username: string } }): Promise<PostEntity> {
    return this.postService.updatePost(id, dto, req.user.username)
  }

  @ApiOperation({ summary: '删除岗位（v1）', description: '硬删除，岗位暂无关联数据' })
  @OperLog('岗位管理')
  @Perms('system:post:delete')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.postService.delete(id)
  }
}
