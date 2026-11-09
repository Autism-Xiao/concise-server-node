import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'

import { BatchDeleteDto } from '../../common/dto/batch-delete.dto'
import { Perms } from '../../common/decorators/perms.decorator'
import { OperLog } from '../../common/decorators/oper-log.decorator'
import { sendXlsx } from '../../helper/export/excel-export'
import { readImportFile } from '../../helper/import/import-file'
import { formatDateTime } from '../../utils/csv.util'
import { setDownloadHeaders } from '../../utils/download.util'
import { buildImportTemplateXlsx } from '../../utils/xlsx.util'
import { BatchAssignRolesDto, BatchUserStatusDto, UpdateAvatarDto } from './dto/batch-user.dto'
import { CreateUserDto } from './dto/create-user.dto'
import { QueryUserDto } from './dto/query-user.dto'
import { ResetUserPasswordDto } from './dto/reset-user-password.dto'
import { RestoreUserDto } from './dto/restore-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { UpdateUserStatusDto } from './dto/update-user-status.dto'
import { UpdateMyProfileDto } from './dto/update-my-profile.dto'
import { UpdatePlatformAdminDto } from './dto/update-platform-admin.dto'
import { UserEntity } from './entities/user.entity'
import { USER_IMPORT_DEFAULT_PASSWORD, USER_IMPORT_MAX_SIZE, UserService } from './user.service'

/** 状态着色：正常绿、冻结红，导出后一眼能看出异常账号 */
const STATUS_STYLE = { 1: { fontColor: 'FF0F766E', fillColor: 'FFE7F7F0' }, 2: { fontColor: 'FFB42318', fillColor: 'FFFDECEC' } }

/**
 * 用户管理接口 V1：/api/v1/users/**
 *
 * 版本策略：URL 前缀做版本；旧路由（/api/users/**）默认不注册（见 config/legacy-routes.config.ts）。
 * 前端用户管理页已全部走 v1。
 */
@ApiTags('用户管理 V1')
@ApiBearerAuth('jwt')
@Controller('v1/users')
export class UserV1Controller {
  constructor(private readonly userService: UserService) {}

  @ApiOperation({
    summary: '分页查询用户列表（v1）',
    description: '支持 keyword 模糊匹配账号/真实姓名/电话、status 精确过滤、deptId/deptIds 部门过滤；需 system:user:list'
  })
  @ApiOkResponse({ description: '分页结果', type: [UserEntity] })
  @Perms('system:user:list')
  @Get()
  list(@Query() query: QueryUserDto, @Request() req: { user: UserEntity }) {
    return this.userService.listByQuery(query, req.user)
  }

  @ApiOperation({
    summary: '导出用户 Excel（v1）',
    description: '与列表同过滤条件（keyword/status/deptId），不分页，单次最多 5000 行；带大标题、冻结表头与斑马纹；需 system:user:export'
  })
  @Perms('system:user:export')
  @Get('export')
  async export(@Query() query: QueryUserDto, @Request() req: { user: UserEntity }, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const users = await this.userService.exportUsers(query, req.user)
    const filters = [
      query.keyword ? `关键字=${query.keyword}` : '',
      query.status ? `状态=${Number(query.status) === 1 ? '正常' : '冻结'}` : '',
      query.deptId || query.deptIds ? '按部门筛选' : ''
    ]

    return sendXlsx({
      res,
      sheetName: '用户列表',
      columns: [
        { header: '登录账号', width: 20 },
        { header: '真实姓名', width: 14 },
        { header: '手机号', width: 16 },
        { header: '邮箱', width: 26 },
        { header: '性别', width: 8, align: 'center' },
        { header: '状态', width: 10, align: 'center' },
        { header: '角色', width: 24 },
        { header: '岗位', width: 20 },
        { header: '所属部门', width: 26 },
        { header: '工号', width: 14 },
        { header: '创建时间', width: 20, align: 'center' }
      ],
      rows: users.map(user => [
        user.username,
        user.realname ?? '',
        user.phone ?? '',
        user.email ?? '',
        user.sex === 1 ? '男' : user.sex === 2 ? '女' : '未知',
        user.status === 2 ? '冻结' : '正常',
        (user.roles ?? []).map(role => role.roleName ?? role.roleCode).join(' / '),
        (user.posts ?? []).map(post => post.postName ?? post.postCode).join(' / '),
        (user.depts ?? []).map(dept => dept.departName).join(' / '),
        user.workNo ?? '',
        formatDateTime(user.createTime)
      ]),
      notes: ['说明：密码与密码盐不导出；角色、部门有多个时用「/」分隔，部门顺序即主次。', '本文件由 concise 管理系统导出，如非本人操作请及时联系系统管理员。'],
      cellStyle: (rowIndex, columnIndex, value) => {
        if (columnIndex === 5 && typeof value === 'string') {
          return value === '冻结' ? STATUS_STYLE[2] : STATUS_STYLE[1]
        }
        return undefined
      },
      meta: { operator: req.user?.username, count: users.length, filters },
      filePrefix: 'users',
      displayName: '用户列表'
    })
  }

  @ApiOperation({
    summary: '下载用户导入模板 Excel（v1）',
    description: '首个工作表为填写说明 + 表头（必填列带 * 与批注），第二个工作表为填写示例；需 system:user:import'
  })
  @Perms('system:user:import')
  @Get('import-template')
  async downloadTemplate(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const buffer = await buildImportTemplateXlsx({
      sheetName: '用户导入',
      title: '用户导入模板',
      notes: [
        '填写说明（请从「用户导入」这张表的表头下方开始填写，不要改动表头；示例见第二张表）：',
        '1. 带 * 的列为必填；「登录账号」已存在时更新该用户，不存在则新增。',
        `2. 登录账号：3~100 位、以字母开头，只能包含字母/数字/下划线/点/横线/@。密码留空时，新建用户使用初始密码 ${USER_IMPORT_DEFAULT_PASSWORD}，更新用户保留原密码。`,
        '3. 角色填角色名称或角色编码，部门填部门名称；多个用「/」分隔，第一个部门为主部门。',
        '4. 性别填「男」/「女」，状态填「正常」/「冻结」，生日用 1990-01-01 格式；留空表示不设置（更新时表示不改）。'
      ],
      columns: [
        { header: '登录账号', width: 20, required: true, hint: '3~100 位、字母开头；已存在则更新该用户' },
        { header: '真实姓名', width: 14, required: true },
        { header: '密码', width: 16, hint: '留空：新建用 123456 / 更新不改密码' },
        { header: '手机号', width: 16 },
        { header: '邮箱', width: 26 },
        { header: '性别', width: 8, hint: '男 / 女' },
        { header: '生日', width: 14, hint: '格式 1990-01-01' },
        { header: '工号', width: 14 },
        { header: '所属部门', width: 24, hint: '部门名称，多个用 / 分隔，第一个为主部门' },
        { header: '角色', width: 24, hint: '角色名称或编码，多个用 / 分隔' },
        { header: '状态', width: 10, hint: '正常 / 冻结' }
      ],
      samples: [['zhangsan', '张三', '123456', '13800000000', 'zhangsan@demo.com', '男', '1992-03-08', '00012', '技术部/产品部', '普通员工', '正常']]
    })
    setDownloadHeaders(res, 'users-import-template.xlsx', '用户导入模板.xlsx')
    return new StreamableFile(buffer)
  }

  @ApiOperation({
    summary: '导入用户 Excel（v1）',
    description:
      'multipart/form-data，字段名 file；支持 .xlsx（推荐）与 .csv；按「登录账号」判定新增/更新；部门/角色按名称匹配，找不到则该行失败；单行失败不影响其他行'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary', description: 'Excel 文件（.xlsx，≤5MB，≤2000 行）；兼容 .csv（UTF-8）' } },
      required: ['file']
    }
  })
  @OperLog('用户管理')
  @Perms('system:user:import')
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: USER_IMPORT_MAX_SIZE } }))
  async import(@UploadedFile() file: Express.Multer.File | undefined, @Request() req: { user: { username: string } }) {
    // 模板头部有大标题与说明，按表头关键字定位，避免把标题当列名
    const table = await readImportFile(file, { headerKeys: ['登录账号', '账号', '用户名', 'username'] })
    return this.userService.importUsers(table.rows, table.headerRow, req.user?.username)
  }

  @ApiOperation({ summary: '回收站：已软删用户分页列表（v1）', description: 'keyword 模糊搜账号/姓名/电话；恢复见 PUT :id/restore；需 system:user:list' })
  @Perms('system:user:list')
  @Get('recycled')
  listRecycled(@Query() query: QueryUserDto) {
    return this.userService.listRecycled(query)
  }

  @ApiOperation({
    summary: '批量查用户账号（v1，选人控件回显用）',
    description: 'ids 英文逗号分隔，最多 100 个；只返回 id/账号/姓名，过滤已软删用户。登录即可访问（公告、日程等「选人」场景回显用，不要求用户管理权限）'
  })
  @Get('lookup')
  lookup(@Query('ids') ids?: string) {
    return this.userService.lookupBrief((ids ?? '').split(','))
  }

  @ApiOperation({
    summary: '我的资料（v1）',
    description: '当前登录用户的完整资料 + 角色/部门/岗位/职级/水印；登录即可访问，不需要 system:user:list（个人资料页专用）'
  })
  @ApiOkResponse({ description: '我的资料', type: UserEntity })
  @Get('me')
  me(@Request() req: { user: UserEntity }) {
    return this.userService.findMyProfile(req.user.id)
  }

  @ApiOperation({
    summary: '更新我的资料（v1）',
    description:
      '本人可改：姓名 / 邮箱 / 手机号 / 座机 / 性别 / 生日 / 简介；空串表示清空该字段。账号、工号、状态、角色、部门、密码各有专用接口，塞进来也会被忽略（不能自助提权）'
  })
  @OperLog('个人资料')
  @Put('me')
  updateMe(@Body() dto: UpdateMyProfileDto, @Request() req: { user: UserEntity }) {
    return this.userService.updateMyProfile(req.user.id, dto)
  }

  @ApiOperation({ summary: '查询用户详情（v1，含角色与部门）', description: '需 system:user:list' })
  @ApiOkResponse({ description: '用户信息', type: UserEntity })
  @Perms('system:user:list')
  @Get(':id')
  findOne(@Param('id') id: string): Promise<UserEntity> {
    return this.userService.findOneDetail(id)
  }

  @ApiOperation({ summary: '创建用户（v1）', description: '32位主键自动生成；密码按 JeecgBoot 算法加密入库；可同时传 roleIds/deptIds' })
  @OperLog('用户管理')
  @Perms('system:user:add')
  @Post()
  async create(@Body() dto: CreateUserDto, @Request() req: { user: { username: string } }) {
    const user = await this.userService.create(dto, req.user.username)
    return this.userService.stripPassword(user)
  }

  @ApiOperation({ summary: '更新用户（v1）', description: 'username 不可修改（密码算法绑定账号）；改密码自动换新盐' })
  @OperLog('用户管理')
  @Perms('system:user:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Request() req: { user: { username: string } }) {
    return this.userService.update(id, dto, req.user.username)
  }

  @ApiOperation({ summary: '批量删除用户（v1）', description: '单次最多 200 条；内置管理员该条失败并返回原因；需 system:user:delete' })
  @OperLog('用户管理')
  @Perms('system:user:delete')
  @Post('batch-delete')
  batchDelete(@Body() dto: BatchDeleteDto) {
    return this.userService.batchDelete(dto.ids)
  }

  @ApiOperation({
    summary: '批量启用/停用（v1）',
    description: '与单条同规则：内置 admin 不可停用、停用自动踢全部会话；单条失败不阻断其他条，逐条返回原因；需 system:user:update'
  })
  @OperLog('用户管理')
  @Perms('system:user:update')
  @Post('batch-status')
  batchUpdateStatus(@Body() dto: BatchUserStatusDto) {
    return this.userService.batchUpdateStatus(dto.ids, dto.status, dto.reason)
  }

  @ApiOperation({
    summary: '批量分配角色（v1）',
    description: '对列表内每个用户全量覆盖绑定同一组角色（与单个用户绑定角色同语义）；任一角色不存在则整体拒绝；需 system:user:update'
  })
  @OperLog('用户管理')
  @Perms('system:user:update')
  @Post('batch-roles')
  batchAssignRoles(@Body() dto: BatchAssignRolesDto) {
    return this.userService.batchAssignRoles(dto.ids, dto.roleIds)
  }

  @ApiOperation({ summary: '删除用户（v1，软删除）' })
  @OperLog('用户管理')
  @Perms('system:user:delete')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.userService.delete(id)
  }

  @ApiOperation({ summary: '为用户绑定角色（v1，全量覆盖）' })
  @OperLog('用户管理')
  @Perms('system:user:update')
  @Put(':id/roles')
  async assignRoles(@Param('id') id: string, @Body() dto: { roleIds: string[] }) {
    await this.userService.assignRoles(id, dto.roleIds)
    return this.userService.findOneWithRoles(id)
  }

  @ApiOperation({
    summary: '为用户绑定部门（v1，全量覆盖）',
    description: '写入 sys_user_depart；数组顺序即主次，第一个为主部门，同步 depart_ids 与 org_code'
  })
  @OperLog('用户管理')
  @Perms('system:user:update')
  @Put(':id/depts')
  async assignDepts(@Param('id') id: string, @Body() dto: { deptIds: string[] }) {
    await this.userService.assignDepts(id, dto.deptIds ?? [])
    return this.userService.findOneDetail(id)
  }

  @ApiOperation({
    summary: '重置密码（v1）',
    description:
      'password 留空则服务端生成 12 位易读随机口令；明文仅在本次响应返回一次，不落库不进日志；重置后该用户全部在线会话立即失效；需 system:user:reset-password'
  })
  @OperLog('用户管理')
  @Perms('system:user:reset-password')
  @Put(':id/password')
  resetPassword(@Param('id') id: string, @Body() dto: ResetUserPasswordDto) {
    return this.userService.resetPassword(id, dto.password)
  }

  @ApiOperation({ summary: '冻结/解冻（v1）', description: 'status：1 正常 / 2 冻结；冻结自动踢掉全部在线会话；内置 admin 不允许冻结；需 system:user:update' })
  @OperLog('用户管理')
  @Perms('system:user:update')
  @Put(':id/status')
  setStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto) {
    return this.userService.setStatus(id, dto.status)
  }

  @ApiOperation({
    summary: '授予/取消平台管理员（v1）',
    description:
      '平台管理员 = 可跨租户视角、可访问 scope=platform 的权限点。权限点自身是 platform 级：只有平台管理员能调用本接口。不能取消自己、不能取消系统最后一个平台管理员；最多 30 秒生效'
  })
  @OperLog('用户管理')
  @Perms('system:user:platform')
  @Put(':id/platform-admin')
  async setPlatformAdmin(
    @Param('id') id: string,
    @Body() dto: UpdatePlatformAdminDto,
    @Request() req: { user: { id: string; username?: string; isPlatformAdmin?: number } }
  ) {
    const user = await this.userService.setPlatformAdmin(id, dto.isPlatformAdmin, req.user)
    return this.userService.stripPassword(user)
  }

  @ApiOperation({ summary: '强制下线（v1，按用户）', description: '踢掉该用户全部在线会话（用户级拉黑 + 删会话），返回踢掉的会话数；需 system:online:kick' })
  @OperLog('用户管理')
  @Perms('system:online:kick')
  @Post(':id/force-offline')
  forceOffline(@Param('id') id: string) {
    return this.userService.forceOffline(id)
  }

  @ApiOperation({ summary: '解锁账号（v1）', description: '清零登录失败计数（密码连错 5 次锁定 24 小时后使用，阈值/时长可配）；幂等；需 system:user:update' })
  @OperLog('用户管理')
  @Perms('system:user:update')
  @Delete(':id/lock')
  unlock(@Param('id') id: string) {
    return this.userService.unlock(id)
  }

  @ApiOperation({
    summary: '恢复软删用户（v1）',
    description: '账号恢复为空壳（角色/部门已随软删清空），可传 roleIds/deptIds 顺带重绑；用户名被占用时拒绝；需 system:user:restore'
  })
  @OperLog('用户管理')
  @Perms('system:user:restore')
  @Put(':id/restore')
  restore(@Param('id') id: string, @Body() dto: RestoreUserDto) {
    return this.userService.restore(id, dto.roleIds, dto.deptIds)
  }

  @ApiOperation({
    summary: '清除用户权限缓存（v1）',
    description: '按用户当前挂的角色逐个失效权限缓存（缓存按角色分片）；改角色/改权限后未生效时使用；幂等；需 system:user:update'
  })
  @OperLog('用户管理')
  @Perms('system:user:update')
  @Delete(':id/permission-cache')
  clearPermissionCache(@Param('id') id: string) {
    return this.userService.clearPermissionCache(id)
  }

  @ApiOperation({ summary: '重置用户头像（v1）', description: '清除该用户的自定义头像，恢复为系统默认；需 system:user:update' })
  @OperLog('用户管理')
  @Perms('system:user:update')
  @Delete(':id/avatar')
  resetAvatar(@Param('id') id: string) {
    return this.userService.setAvatar(id, null)
  }

  @ApiOperation({ summary: '设置我的头像（v1）', description: 'body.avatar 传 POST /v1/upload 返回的相对路径；空串/null 清除；登录用户即可操作自己的头像' })
  @OperLog('用户管理')
  @Put('me/avatar')
  setMyAvatar(@Body() dto: UpdateAvatarDto, @Request() req: { user: UserEntity }) {
    return this.userService.setAvatar(req.user.id, dto.avatar)
  }
}
