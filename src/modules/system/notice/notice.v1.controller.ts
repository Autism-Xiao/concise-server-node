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
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'
import { IsIn, IsOptional } from 'class-validator'
import type { Response } from 'express'

import { BatchDeleteDto } from '../../../common/dto/batch-delete.dto'
import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
import { PagerDto } from '../../../common/dto/pager.dto'
import { parseCsv } from '../../../utils/csv.util'
import { setDownloadHeaders } from '../../../utils/download.util'
import { buildImportTemplateXlsx, readXlsxTable } from '../../../utils/xlsx.util'
import { CreateNoticeDto } from './dto/create-notice.dto'
import { QueryNoticeDto } from './dto/query-notice.dto'
import { UpdateNoticeDto } from './dto/update-notice.dto'
import { SysAnnouncementEntity } from './entities/sys-announcement.entity'
import { NOTICE_IMPORT_MAX_SIZE, NoticeService } from './notice.service'

class QueryPublishedNoticeDto extends PagerDto {
  @ApiPropertyOptional({ description: '消息类型：1 通知公告 / 2 系统消息', example: '1', enum: ['1', '2'] })
  @IsOptional()
  @IsIn(['1', '2'])
  msgCategory?: string
}

/**
 * 通知公告接口 V1：/api/v1/notices/**
 *
 * 表 sys_announcement（对齐 JeecgBoot）：send_status '0' 未发布 / '1' 已发布 / '2' 已撤销；
 * 删除为软删（del_flag='1'）。管理端接口按按钮权限 system:notice:* 控制，
 * /published 面向所有登录用户（登录后即可读已发布公告）。
 */
@ApiTags('通知公告 V1')
@ApiBearerAuth('jwt')
@Controller('v1/notices')
export class NoticeV1Controller {
  constructor(private readonly noticeService: NoticeService) {}

  @ApiOperation({ summary: '已发布公告列表（v1，所有登录用户）', description: '仅返回已发布且处于生效期内的公告，按发布时间倒序' })
  @ApiOkResponse({ description: '分页结果', type: SysAnnouncementEntity })
  @Get('published')
  listPublished(@Query() query: QueryPublishedNoticeDto) {
    return this.noticeService.listPublished(query)
  }

  @ApiOperation({ summary: '公告分页列表（v1，管理端，含未发布与已撤销）' })
  @ApiOkResponse({ description: '分页结果', type: SysAnnouncementEntity })
  @Perms('system:notice:list')
  @Get()
  list(@Query() query: QueryNoticeDto) {
    return this.noticeService.listByQuery(query)
  }

  @ApiOperation({
    summary: '下载公告导入模板 Excel（v1）',
    description: '首个工作表为填写说明 + 表头（标题为必填，带 * 与批注），第二个工作表为填写示例；需 system:notice:import'
  })
  @Perms('system:notice:import')
  @Get('import-template')
  async downloadTemplate(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const buffer = await buildImportTemplateXlsx({
      sheetName: '公告导入',
      title: '通知公告导入模板',
      notes: [
        '填写说明（请从「公告导入」这张表的表头下方开始填写，不要改动表头；示例见第二张表）：',
        '1. 带 * 的列为必填。「标题」是唯一识别依据：标题已存在则更新该条公告，不存在则新增。',
        '2. 状态填「未发布」「已发布」「已撤销」，留空表示新建时未发布、更新时保持原状态。',
        '3. 生效开始/结束时间用 2026-01-01 或 2026-01-01 08:00 格式，留空表示不限（更新时表示不修改）。',
        '4. 通告对象填「全体用户」或「指定用户」；填「指定用户」时必须在「指定用户」列填登录账号或姓名，多个用 / 分隔。',
        '5. 更新已有公告时，只覆盖填了值的列；「内容」留空表示不改动原内容。',
        '6. 同一份文件里标题不能重复，重复行会被跳过。'
      ],
      columns: [
        { header: '标题', width: 32, required: true, hint: '不超过 100 字；同标题视为同一条公告' },
        { header: '类型', width: 12, hint: '通知公告 / 系统消息，默认通知公告' },
        { header: '优先级', width: 10, hint: '高 / 中 / 低，默认中' },
        { header: '状态', width: 10, hint: '未发布 / 已发布 / 已撤销' },
        { header: '通告对象', width: 12, hint: '全体用户 / 指定用户' },
        { header: '指定用户', width: 24, hint: '登录账号或姓名，多个用 / 分隔' },
        { header: '生效开始', width: 20, hint: '2026-01-01 或 2026-01-01 08:00' },
        { header: '生效结束', width: 20, hint: '留空表示不限' },
        { header: '内容', width: 46, hint: '公告正文，可含换行' }
      ],
      samples: [
        ['系统 V1.0 上线通知', '通知公告', '高', '已发布', '全体用户', '', '2026-11-01', '2026-12-31', '本次上线包含用户、角色、菜单与公告管理。'],
        ['给运维组的提醒', '系统消息', '中', '未发布', '指定用户', 'admin/guest', '', '', '请在本周五前完成备份检查。']
      ]
    })
    setDownloadHeaders(res, 'notices-import-template.xlsx', '公告导入模板.xlsx')
    return new StreamableFile(buffer)
  }

  @ApiOperation({
    summary: '导入公告 Excel（v1）',
    description: 'multipart/form-data，字段名 file；支持 .xlsx（推荐）与 .csv；标题已存在则更新该条，否则新增；指定用户按账号/姓名解析；单行失败不影响其他行'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary', description: 'Excel 文件（.xlsx，≤5MB，≤1000 行）；兼容 .csv（UTF-8）' } },
      required: ['file']
    }
  })
  @OperLog('通知公告')
  @Perms('system:notice:import')
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: NOTICE_IMPORT_MAX_SIZE } }))
  async import(@UploadedFile() file: Express.Multer.File | undefined, @Request() req: { user: { username: string } }) {
    if (!file) {
      throw new BadRequestException('未接收到文件，请选择 Excel 后重试')
    }
    const filename = file.originalname ?? ''
    const operator = req.user?.username
    if (/\.xlsx$/i.test(filename)) {
      // 模板头部有大标题与说明，按表头关键字定位，避免把标题行当列名
      const table = await readXlsxTable(file.buffer, { headerKeys: ['标题', '公告标题', 'title'] })
      return this.noticeService.importNotices(table.rows, table.headerRow, operator)
    }
    if (/\.csv$/i.test(filename)) {
      const text = file.buffer.toString('utf8')
      if (text.includes('\uFFFD')) {
        throw new BadRequestException('CSV 文件编码不是 UTF-8，请改用 .xlsx 导入，或另存为「CSV UTF-8（逗号分隔）」')
      }
      return this.noticeService.importNotices(parseCsv(text), 1, operator)
    }
    throw new BadRequestException('仅支持 .xlsx（推荐）或 .csv 文件')
  }

  @ApiOperation({ summary: '公告详情（v1）' })
  @Perms('system:notice:list')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.noticeService.findOneActive(id)
  }

  @ApiOperation({ summary: '创建公告（v1）', description: 'sendStatus=1 时创建即发布并记录发布时间；默认未发布' })
  @OperLog('通知公告')
  @Perms('system:notice:add')
  @Post()
  create(@Body() dto: CreateNoticeDto, @Request() req: { user: { username: string } }) {
    return this.noticeService.createNotice(dto, req.user.username)
  }

  @ApiOperation({ summary: '更新公告（v1）', description: '状态切到已发布时自动补发布时间，切回未发布时清空发布痕迹' })
  @OperLog('通知公告')
  @Perms('system:notice:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNoticeDto, @Request() req: { user: { username: string } }) {
    return this.noticeService.updateNotice(id, dto, req.user.username)
  }

  @ApiOperation({ summary: '发布公告（v1）', description: '未发布/已撤销的公告发布上线；已发布的重复发布会被拒绝' })
  @OperLog('通知公告')
  @Perms('system:notice:publish')
  @Put(':id/publish')
  publish(@Param('id') id: string, @Request() req: { user: { username: string } }) {
    return this.noticeService.publish(id, req.user.username)
  }

  @ApiOperation({ summary: '撤销公告（v1）', description: '仅已发布的公告可撤销，记录撤销时间，状态置为已撤销' })
  @OperLog('通知公告')
  @Perms('system:notice:publish')
  @Put(':id/revoke')
  revoke(@Param('id') id: string, @Request() req: { user: { username: string } }) {
    return this.noticeService.revoke(id, req.user.username)
  }

  @ApiOperation({ summary: '批量删除公告（v1）', description: '单次最多 200 条；已发布的公告该条失败并返回原因；需 system:notice:delete' })
  @OperLog('通知公告')
  @Perms('system:notice:delete')
  @Post('batch-delete')
  batchDelete(@Body() dto: BatchDeleteDto) {
    return this.noticeService.batchDelete(dto.ids)
  }

  @ApiOperation({ summary: '删除公告（v1）', description: '软删除（del_flag=1）；已发布的公告需先撤销' })
  @OperLog('通知公告')
  @Perms('system:notice:delete')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.noticeService.delete(id)
  }
}
