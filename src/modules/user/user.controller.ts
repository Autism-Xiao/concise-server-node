import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'

import { CreateUserDto } from './dto/create-user.dto'
import { QueryUserDto } from './dto/query-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { UserEntity } from './entities/user.entity'
import { UserService } from './user.service'

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /** 分页列表 GET /api/users?page=1&pageSize=10&keyword=xx&status=1 */
  @Get()
  list(@Query() query: QueryUserDto) {
    return this.userService.listByQuery(query)
  }

  /** 详情 GET /api/users/:id */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<UserEntity> {
    return this.userService.findOne(id)
  }

  /** 创建 POST /api/users */
  @Post()
  async create(@Body() dto: CreateUserDto) {
    const user = await this.userService.create(dto)
    return this.userService.stripPassword(user)
  }

  /** 更新 PUT /api/users/:id */
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    return this.userService.update(id, dto)
  }

  /** 删除 DELETE /api/users/:id */
  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.userService.delete(id)
  }
}
