import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Roles } from '../../common/decorators/roles.decorator'
import { Perms } from '../../common/decorators/perms.decorator'
import { OperLog } from '../../common/decorators/oper-log.decorator'
import { CreateUserDto } from './dto/create-user.dto'
import { QueryUserDto } from './dto/query-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { UserEntity } from './entities/user.entity'
import { UserService } from './user.service'

@ApiTags('用户管理')
@ApiBearerAuth('jwt')
@Roles('admin')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @ApiOperation({ summary: '分页查询用户列表', description: '支持 keyword 模糊匹配账号/真实姓名/电话、status 精确过滤' })
  @ApiOkResponse({ description: '分页结果', type: [UserEntity] })
  @Get()
  list(@Query() query: QueryUserDto) {
    return this.userService.listByQuery(query)
  }

  @ApiOperation({ summary: '查询用户详情（含角色与部门）' })
  @ApiOkResponse({ description: '用户信息', type: UserEntity })
  @Get(':id')
  findOne(@Param('id') id: string): Promise<UserEntity> {
    return this.userService.findOneDetail(id)
  }

  @ApiOperation({ summary: '创建用户', description: '32位主键自动生成；密码按 JeecgBoot PBEWithMD5AndDES(username, password, salt) 入库' })
  @OperLog('用户管理')
  @Perms('system:user:add')
  @Post()
  async create(@Body() dto: CreateUserDto, @Request() req: { user: { username: string } }) {
    const user = await this.userService.create(dto, req.user.username)
    return this.userService.stripPassword(user)
  }

  @ApiOperation({ summary: '更新用户', description: 'username 不可修改（密码算法绑定账号）；改密码自动换新盐' })
  @OperLog('用户管理')
  @Perms('system:user:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Request() req: { user: { username: string } }) {
    return this.userService.update(id, dto, req.user.username)
  }

  @ApiOperation({ summary: '删除用户（软删除）' })
  @OperLog('用户管理')
  @Perms('system:user:delete')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.userService.delete(id)
  }

  @ApiOperation({ summary: '为用户绑定角色（全量覆盖）' })
  @Put(':id/roles')
  async assignRoles(@Param('id') id: string, @Body() dto: { roleIds: string[] }) {
    await this.userService.assignRoles(id, dto.roleIds)
    return this.userService.findOneWithRoles(id)
  }
}
