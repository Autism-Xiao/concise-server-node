import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
import { RateLimit } from '../../../common/decorators/rate-limit.decorator'
import { Idempotent } from '../../../common/decorators/idempotent.decorator'
import { Pagination } from '../../../helper/paginate'
import { ApplyTenantDto } from './dto/apply-tenant.dto'
import { AssignUsersDto, QueryTenantUserDto, SwitchTenantDto } from './dto/tenant-user.dto'
import { CreateTenantAdminDto } from './dto/create-tenant-admin.dto'
import { CreateTenantDto } from './dto/create-tenant.dto'
import { QueryExpiringTenantDto } from './dto/query-expiring-tenant.dto'
import { QueryTenantDto } from './dto/query-tenant.dto'
import { SetTenantPackageDto } from './dto/set-tenant-package.dto'
import { UpdateTenantDto } from './dto/update-tenant.dto'
import { TenantEntity } from './entities/tenant.entity'
import { TenantExportService } from './tenant-export.service'
import { TenantPackageService } from './tenant-package.service'
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
    private readonly provisionService: TenantProvisionService,
    private readonly packageService: TenantPackageService,
    private readonly exportService: TenantExportService
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

  @ApiOperation({
    summary: '即将到期租户列表',
    description:
      '平台运营视图：未来 N 天内到期（含今天）+ 已到期未停用（daysLeft 为负）的正常租户，按到期日升序；' +
      '每日 tenantExpireJob 会按窗口给开通人发站内信提醒；需 system:tenant:list'
  })
  @Get('expiring')
  @Perms('system:tenant:list')
  listExpiring(@Query() query: QueryExpiringTenantDto) {
    return this.tenantService.listExpiring(query.days)
  }

  @ApiOperation({
    summary: '租户仪表盘',
    description:
      '平台运营聚合：概览（总数/正常/停用/已到期未停用/30 天内到期）、套餐分布、注册趋势（近 6 月）、' +
      'API 调用量 Top10（当月 metering 数据，攒批有 ≤30s 延迟）、配额水位（活跃成员/存储 vs 租户限额，0=不限）；需 system:tenant:list'
  })
  @Get('dashboard')
  @Perms('system:tenant:list')
  dashboard() {
    return this.tenantService.dashboard()
  }

  @ApiOperation({
    summary: '导出租户数据（JSON）',
    description:
      '平台运营：聚合导出租户档案/角色/成员(含角色绑定，不含凭证列)/功能套餐/配置覆盖行/月度用量/文件元数据（不含内容，上限 5000 行）；用于退租交接与审计归档；需 system:tenant:list'
  })
  @Get(':id/export')
  @Perms('system:tenant:list')
  async export(@Param('id', ParseIntPipe) id: number) {
    return this.exportService.export(id)
  }

  @ApiOperation({ summary: '切换当前租户', description: '校验归属后记住选择；后续请求用 X-Tenant-Id 请求头生效' })
  @Post('switch')
  switch(@Req() req: AuthedRequest, @Body() dto: SwitchTenantDto) {
    return this.tenantService.switch(req.user!.id, dto.tenantId, req.user?.username)
  }

  @ApiOperation({
    summary: '租户功能套餐详情',
    description: '已开通菜单 id 集合 + 可勾选的租户级菜单树（功能套餐弹窗回显）；需 system:tenant:list'
  })
  @Get(':id/menus')
  @Perms('system:tenant:list')
  async getPackage(@Param('id', ParseIntPipe) id: number) {
    await this.tenantService.findOne(id)
    return this.packageService.getPackageDetail(id)
  }

  @ApiOperation({
    summary: '全量重设租户功能套餐',
    description: 'menuIds 为完整勾选列表（租户级菜单+按钮，空数组即清空）；收窄不回收角色既有授权，读取端按交集生效；需 system:tenant:edit'
  })
  @Put(':id/menus')
  @Perms('system:tenant:edit')
  @OperLog('租户管理')
  async setPackage(@Param('id', ParseIntPipe) id: number, @Body() dto: SetTenantPackageDto) {
    // 套餐服务只负责写，存在性由调用方先确认；否则会留下孤儿 sys_tenant_menu 行
    await this.tenantService.findOne(id)
    return this.packageService.setPackage(id, dto.menuIds)
  }

  @ApiOperation({
    summary: '自助开通资格',
    description: '登录即可调用：返回是否 VIP、VIP 到期时间、已开租户数、上限与不可开通原因（NEED_VIP / QUOTA_EXCEEDED）'
  })
  @Get('apply/quota')
  applyQuota(@Req() req: AuthedRequest) {
    return this.tenantService.applyQuota(req.user!.id)
  }

  @ApiOperation({
    summary: '自助开通租户',
    description: '登录即可调用；需有效 VIP（平台管理员免检）且未超 tenant.vip.maxTenants 上限。成功后当前用户成为该租户管理员，并自动切换为登录租户'
  })
  // 注意：限流守卫在 Jwt 之前执行，拿不到 req.user，by:'account' 实际退化成 IP 维度，
  // 所以这里直接按 IP 计数（10 次/小时，够正常用户开团队、也压得住刷接口）。
  @RateLimit({ limit: 10, window: 3600, message: '开通过于频繁，请稍后再试' })
  // 双击防护：15 秒窗口内同用户同参数只落一次（连点两下会开出两个同名团队）
  @Idempotent({ window: 15, message: '开通请求正在处理，请勿重复提交' })
  @OperLog('租户管理')
  @Post('apply')
  apply(@Body() dto: ApplyTenantDto, @Req() req: AuthedRequest) {
    return this.tenantService.applyCreate(req.user!.id, dto, req.user?.username)
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

  @ApiOperation({
    summary: '为租户建管理员账号',
    description: '一步完成「建号 + 加入本租户 + 绑本租户 admin 角色」；用户名全局唯一，不能与已有账号重复。需 system:tenant:edit'
  })
  @Post(':id/admin')
  @Perms('system:tenant:edit')
  @OperLog('租户管理')
  createAdmin(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateTenantAdminDto, @Req() req: AuthedRequest) {
    return this.tenantService.createAdmin(id, dto, req.user?.username)
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
