import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Roles } from '../../common/decorators/roles.decorator'
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

  @ApiOperation({ summary: '分页查询用户列表', description: '支持 keyword 模糊匹配用户名/昵称、status 精确过滤' })
  @ApiOkResponse({ description: '分页结果', type: [UserEntity] })
  @Get()
  list(@Query() query: QueryUserDto) {
    return this.userService.listByQuery(query)
  }

  @ApiOperation({ summary: '查询用户详情' })
  @ApiOkResponse({ description: '用户信息', type: UserEntity })
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<UserEntity> {
    return this.userService.findOne(id)
  }

  @ApiOperation({ summary: '创建用户', description: '密码入库前自动 bcrypt 哈希，响应不返回密码' })
  @Post()
  async create(@Body() dto: CreateUserDto) {
    const user = await this.userService.create(dto)
    return this.userService.stripPassword(user)
  }

  @ApiOperation({ summary: '更新用户' })
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    return this.userService.update(id, dto)
  }

  @ApiOperation({ summary: '删除用户' })
  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.userService.delete(id)
  }

  @ApiOperation({ summary: '为用户绑定角色（全量覆盖）' })
  @Put(':id/roles')
  async assignRoles(@Param('id', ParseIntPipe) id: number, @Body() dto: { roleIds: number[] }) {
    await this.userService.assignRoles(id, dto.roleIds)
    return this.userService.findOneWithRoles(id)
  }
}
