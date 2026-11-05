import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request, Res, StreamableFile } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'

import { OperLog } from '../../../common/decorators/oper-log.decorator'
import { Perms } from '../../../common/decorators/perms.decorator'
import { formatDateTime } from '../../../utils/csv.util'
import { setDownloadHeaders } from '../../../utils/download.util'
import { buildXlsx } from '../../../utils/xlsx.util'
import { CreateJobDto } from './dto/create-job.dto'
import { QueryJobDto } from './dto/query-job.dto'
import { UpdateJobDto } from './dto/update-job.dto'
import { SysQuartzJobEntity } from './entities/sys-quartz-job.entity'
import { JobService } from './job.service'

/**
 * 定时任务接口 V1：/api/v1/jobs/**
 *
 * 表对齐 JeecgBoot sys_quartz_job；job_class_name 在 Node 侧是「执行器标识」，
 * 可选值见 GET /api/v1/jobs/handlers。status：0 正常（运行中）/ -1 停止。
 */
@ApiTags('定时任务 V1')
@ApiBearerAuth('jwt')
@Controller('v1/jobs')
export class JobV1Controller {
  constructor(private readonly jobService: JobService) {}

  @ApiOperation({ summary: '定时任务分页列表（v1）', description: 'keyword 模糊匹配任务类名/描述；可按状态过滤' })
  @ApiOkResponse({ description: '分页结果', type: SysQuartzJobEntity })
  @Perms('system:job:list')
  @Get()
  list(@Query() query: QueryJobDto) {
    return this.jobService.listByQuery(query)
  }

  @ApiOperation({ summary: '可用执行器清单（v1）', description: '新增/修改任务时 jobClassName 的可选值' })
  @Perms('system:job:list')
  @Get('handlers')
  handlers() {
    return this.jobService.listHandlers()
  }

  @ApiOperation({ summary: '导出定时任务 Excel（v1）', description: '与列表同筛选条件，最多 5000 条；用于配置备份与跨环境对照；需 system:job:export' })
  @Perms('system:job:export')
  @Get('export')
  async export(
    @Query() query: QueryJobDto,
    @Request() req: { user: { username: string } },
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const jobs = await this.jobService.exportJobs(query)
    const buffer = await buildXlsx(
      '定时任务',
      [
        { header: '执行器标识', width: 26 },
        { header: 'cron 表达式', width: 22 },
        { header: '任务参数', width: 20 },
        { header: '任务描述', width: 40 },
        { header: '状态', width: 10, align: 'center' },
        { header: '下次执行', width: 22, align: 'center' },
        { header: '上次执行', width: 22, align: 'center' },
        { header: '上次结果', width: 16 },
        { header: '创建时间', width: 20, align: 'center' }
      ],
      jobs.map(job => [
        job.jobClassName ?? '',
        job.cronExpression ?? '',
        job.parameter ?? '',
        job.description ?? '',
        job.status === 0 ? '运行中' : '已停止',
        job.nextRun ?? '',
        job.lastRun ?? '',
        job.lastResult ?? '',
        formatDateTime(job.createTime)
      ]),
      {
        title: '定时任务配置',
        subtitle: `导出时间：${formatDateTime(new Date())} · 操作人：${req.user?.username ?? '未知'} · 共 ${jobs.length} 条记录${query.keyword ? ` · 筛选：关键字=${query.keyword}` : ''}`,
        notes: ['说明：执行器标识对应后端代码中注册的 handler，不支持导入（不同环境的 handler 需代码同步）。']
      }
    )
    setDownloadHeaders(res, `jobs-${Date.now()}.xlsx`, `定时任务-${formatDateTime(new Date()).slice(0, 10)}.xlsx`)
    return new StreamableFile(buffer)
  }

  @ApiOperation({ summary: '定时任务详情（v1）' })
  @Perms('system:job:list')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.jobService.findDetail(id)
  }

  @ApiOperation({ summary: '创建定时任务（v1）', description: 'status 默认 -1（停止），创建后需手动启动' })
  @OperLog('定时任务')
  @Perms('system:job:add')
  @Post()
  create(@Body() dto: CreateJobDto, @Request() req: { user: { username: string } }) {
    return this.jobService.createJob(dto, req.user.username)
  }

  @ApiOperation({ summary: '更新定时任务（v1）', description: '改动 cron 或状态后自动重挂调度' })
  @OperLog('定时任务')
  @Perms('system:job:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateJobDto, @Request() req: { user: { username: string } }) {
    return this.jobService.updateJob(id, dto, req.user.username)
  }

  @ApiOperation({ summary: '启动定时任务（v1）' })
  @OperLog('定时任务')
  @Perms('system:job:update')
  @Put(':id/resume')
  resume(@Param('id') id: string, @Request() req: { user: { username: string } }) {
    return this.jobService.resume(id, req.user.username)
  }

  @ApiOperation({ summary: '暂停定时任务（v1）' })
  @OperLog('定时任务')
  @Perms('system:job:update')
  @Put(':id/pause')
  pause(@Param('id') id: string, @Request() req: { user: { username: string } }) {
    return this.jobService.pause(id, req.user.username)
  }

  @ApiOperation({ summary: '立即执行一次（v1）', description: '不影响启停状态，用于调试任务' })
  @OperLog('定时任务')
  @Perms('system:job:run')
  @Put(':id/run')
  run(@Param('id') id: string) {
    return this.jobService.runOnce(id)
  }

  @ApiOperation({ summary: '删除定时任务（v1）', description: '逻辑删除（del_flag=1）并停止调度' })
  @OperLog('定时任务')
  @Perms('system:job:delete')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.jobService.deleteJob(id)
    return { deleted: 1 }
  }
}
