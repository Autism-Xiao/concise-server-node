import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
import { Pagination } from '../../../helper/paginate'
import { AssignUsersDto, QueryTenantUserDto, SwitchTenantDto } from './dto/tenant-user.dto'
import { CreateTenantDto } from './dto/create-tenant.dto'
import { QueryTenantDto } from './dto/query-tenant.dto'
import { UpdateTenantDto } from './dto/update-tenant.dto'
import { TenantEntity } from './entities/tenant.entity'
import { TenantProvisionService } from './tenant-provision.service'
import { TenantService } from './tenant.service'

interface AuthedRequest extends Request {
  user?: { id: string; username?: string }
}

/**
 * 租户管理接口 V1：/api/v1/tenants/**
 *
 * - 管理类接口（列表/增删改/分配用户）需要 system:tenant:* 按钮权限，超管默认放通
 * - `mine` / `switch` 是「我的租户」，所有登录用户可用（切换要在自己的归属范围内）
 */
@ApiTags('租户管理 V1')
@ApiBearerAuth('jwt')
@Controller('v1/tenants')
export class TenantV1Controller {
  constructor(
    private readonly tenantService: TenantService,
    private readonly provisionService: TenantProvisionService
  ) {}

  @ApiOperation({ summary: '租户列表（分页）', description: 'keyword 模糊匹配名称/编码/联系人；需 system:tenant:list' })
  @ApiOkResponse({ type: Pagination })
  @Get()
  @Perms('system:tenant:list')
  list(@Query() query: QueryTenantDto) {
    return this.tenantService.list(query)
  }

  @ApiOperation({ summary: '我所属的租户', description: '返回当前生效租户 + 可切换的租户列表（停用/过期带 usable=false）' })
  @Get('mine')
  mine(@Req() req: AuthedRequest) {
    return this.tenantService.mine(req.user!.id)
  }

  @ApiOperation({ summary: '切换当前租户', description: '校验归属后记住选择；后续请求用 X-Tenant-Id 请求头生效' })
  @Post('switch')
  switch(@Req() req: AuthedRequest, @Body() dto: SwitchTenantDto) {
    return this.tenantService.switch(req.user!.id, dto.tenantId)
  }

  @ApiOperation({ summary: '初始化全部租户的默认角色', description: '幂等：补建缺失的 admin/editor/viewer 角色，并补齐新增菜单的授权；需 system:tenant:edit' })
  @Post('provision-all')
  @Perms('system:tenant:edit')
  @OperLog('租户管理')
  provisionAll(@Req() req: AuthedRequest) {
    return this.provisionService.provisionAll(req.user?.username)
  }

  @ApiOperation({ summary: '租户详情', description: '需 system:tenant:list' })
  @Get(':id')
  @Perms('system:tenant:list')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.tenantService.findOne(id)
  }

  @ApiOperation({ summary: '新增租户', description: '编码唯一；需 system:tenant:add' })
  @Post()
  @Perms('system:tenant:add')
  @OperLog('租户管理')
  create(@Body() dto: CreateTenantDto, @Req() req: AuthedRequest) {
    return this.tenantService.create(dto, req.user?.username)
  }

  @ApiOperation({ summary: '编辑租户', description: '改编码会重新校验唯一性；需 system:tenant:edit' })
  @Put(':id')
  @Perms('system:tenant:edit')
  @OperLog('租户管理')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTenantDto, @Req() req: AuthedRequest) {
    return this.tenantService.update(id, dto, req.user?.username)
  }

  @ApiOperation({ summary: '删除租户（软删）', description: '默认租户不可删；租户下有用户时拒绝。需 system:tenant:delete' })
  @Delete(':id')
  @Perms('system:tenant:delete')
  @OperLog('租户管理')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ id: number }> {
    await this.tenantService.remove(id)
    return { id }
  }

  @ApiOperation({ summary: '初始化指定租户的默认角色', description: '幂等：空壳租户补建角色 / 新菜单上线后补齐授权；需 system:tenant:edit' })
  @Post(':id/provision')
  @Perms('system:tenant:edit')
  @OperLog('租户管理')
  async provision(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    // 先确认租户存在（软删的也要拦住），否则会往一个已删除的租户里插角色
    await this.tenantService.findOne(id)
    return this.provisionService.provision(id, req.user?.username)
  }

  @ApiOperation({ summary: '租户下的用户（分页）', description: '需 system:tenant:user' })
  @Get(':id/users')
  @Perms('system:tenant:user')
  listUsers(@Param('id', ParseIntPipe) id: number, @Query() query: QueryTenantUserDto) {
    return this.tenantService.listUsers(id, query)
  }

  @ApiOperation({ summary: '分配用户（覆盖式）', description: '传入的列表即最终名单，多退少补；需 system:tenant:user' })
  @Put(':id/users')
  @Perms('system:tenant:user')
  @OperLog('租户管理')
  assignUsers(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignUsersDto) {
    return this.tenantService.assignUsers(id, dto.userIds)
  }
}

export type { TenantEntity }
