import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Request,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'

import { Perms } from '../../common/decorators/perms.decorator'
import { OperLog } from '../../common/decorators/oper-log.decorator'
import { formatDateTime, parseCsv } from '../../utils/csv.util'
import { setDownloadHeaders } from '../../utils/download.util'
import { buildImportTemplateXlsx, buildXlsx, readXlsxTable } from '../../utils/xlsx.util'
import { CreateUserDto } from './dto/create-user.dto'
import { QueryUserDto } from './dto/query-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { UserEntity } from './entities/user.entity'
import { USER_IMPORT_DEFAULT_PASSWORD, USER_IMPORT_MAX_SIZE, UserService } from './user.service'

/** 状态着色：正常绿、冻结红，导出后一眼能看出异常账号 */
const STATUS_STYLE = { 1: { fontColor: 'FF0F766E', fillColor: 'FFE7F7F0' }, 2: { fontColor: 'FFB42318', fillColor: 'FFFDECEC' } }

/**
 * 用户管理接口 V1：/api/v1/users/**
 *
 * 版本策略：URL 前缀做版本，老版本路由（/api/users/**）继续保留兼容；
 * 前端用户管理页已切换到 v1，旧路由待全部迁移后统一下线。
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
  list(@Query() query: QueryUserDto) {
    return this.userService.listByQuery(query)
  }

  @ApiOperation({
    summary: '导出用户 Excel（v1）',
    description: '与列表同过滤条件（keyword/status/deptId），不分页，单次最多 5000 行；带大标题、冻结表头与斑马纹；需 system:user:export'
  })
  @Perms('system:user:export')
  @Get('export')
  async export(
    @Query() query: QueryUserDto,
    @Request() req: { user: { username: string } },
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const users = await this.userService.exportUsers(query)
    const filters = [
      query.keyword ? `关键字=${query.keyword}` : '',
      query.status ? `状态=${Number(query.status) === 1 ? '正常' : '冻结'}` : '',
      query.deptId || query.deptIds ? '按部门筛选' : ''
    ].filter(Boolean)

    const buffer = await buildXlsx(
      '用户列表',
      [
        { header: '登录账号', width: 20 },
        { header: '真实姓名', width: 14 },
        { header: '手机号', width: 16 },
        { header: '邮箱', width: 26 },
        { header: '性别', width: 8, align: 'center' },
        { header: '状态', width: 10, align: 'center' },
        { header: '角色', width: 24 },
        { header: '所属部门', width: 26 },
        { header: '工号', width: 14 },
        { header: '创建时间', width: 20, align: 'center' }
      ],
      users.map(user => [
        user.username,
        user.realname ?? '',
        user.phone ?? '',
        user.email ?? '',
        user.sex === 1 ? '男' : user.sex === 2 ? '女' : '未知',
        user.status === 2 ? '冻结' : '正常',
        (user.roles ?? []).map(role => role.roleName ?? role.roleCode).join(' / '),
        (user.depts ?? []).map(dept => dept.departName).join(' / '),
        user.workNo ?? '',
        formatDateTime(user.createTime)
      ]),
      {
        title: '用户列表',
        subtitle: `导出时间：${formatDateTime(new Date())} · 操作人：${req.user?.username ?? '未知'} · 共 ${users.length} 条记录${filters.length ? ` · 筛选：${filters.join('，')}` : ''}`,
        notes: [
          '说明：密码与密码盐不导出；角色、部门有多个时用「/」分隔，部门顺序即主次。',
          '本文件由 concise 管理系统导出，如非本人操作请及时联系系统管理员。'
        ],
        cellStyle: (rowIndex, columnIndex, value) => {
          if (columnIndex === 5 && typeof value === 'string') {
            return value === '冻结' ? STATUS_STYLE[2] : STATUS_STYLE[1]
          }
          return undefined
        }
      }
    )
    setDownloadHeaders(res, `users-${Date.now()}.xlsx`, `用户列表-${formatDateTime(new Date()).slice(0, 10)}.xlsx`)
    return new StreamableFile(buffer)
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
    if (!file) {
      throw new BadRequestException('未接收到文件，请选择 Excel 后重试')
    }
    const filename = file.originalname ?? ''
    const operator = req.user?.username
    if (/\.xlsx$/i.test(filename)) {
      // 模板头部有大标题与说明，按表头关键字定位，避免把标题当列名
      const table = await readXlsxTable(file.buffer, { headerKeys: ['登录账号', '账号', '用户名', 'username'] })
      return this.userService.importUsers(table.rows, table.headerRow, operator)
    }
    if (/\.csv$/i.test(filename)) {
      const text = file.buffer.toString('utf8')
      if (text.includes('\uFFFD')) {
        throw new BadRequestException('CSV 文件编码不是 UTF-8，请改用 .xlsx 导入，或另存为「CSV UTF-8（逗号分隔）」')
      }
      return this.userService.importUsers(parseCsv(text), 1, operator)
    }
    throw new BadRequestException('仅支持 .xlsx（推荐）或 .csv 文件')
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
}
