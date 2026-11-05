import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { paginate, Pagination } from '../../../helper/paginate'
import { randomId32 } from '../../../utils/password.util'
import { SysQuartzJobEntity } from './entities/sys-quartz-job.entity'
import { JobHandlerRegistry } from './job.handlers'
import { JobScheduler, type JobExecutionResult, type JobRunRecord } from './job.scheduler'
import type { CreateJobDto } from './dto/create-job.dto'
import type { QueryJobDto } from './dto/query-job.dto'
import type { UpdateJobDto } from './dto/update-job.dto'

/** 列表返回：表字段 + 运行时信息（下次执行 / 上次执行结果） */
export type JobView = SysQuartzJobEntity & JobRunRecord

@Injectable()
export class JobService {
  constructor(
    @InjectRepository(SysQuartzJobEntity)
    private readonly jobRepository: Repository<SysQuartzJobEntity>,
    private readonly scheduler: JobScheduler,
    private readonly registry: JobHandlerRegistry
  ) {}

  /** 分页列表（keyword 模糊匹配任务类名/描述，可按状态过滤） */
  async listByQuery(query: QueryJobDto): Promise<Pagination<JobView>> {
    const qb = this.jobRepository.createQueryBuilder('job').where('job.del_flag = 0').orderBy('job.create_time', 'DESC').addOrderBy('job.id', 'DESC')

    const keyword = query.keyword?.trim()
    if (keyword) {
      qb.andWhere('(job.job_class_name LIKE :kw OR job.description LIKE :kw)', { kw: `%${keyword}%` })
    }
    if (query.status !== undefined) {
      qb.andWhere('job.status = :status', { status: query.status })
    }

    const result = await paginate(qb, { page: query.page, pageSize: query.pageSize })
    return new Pagination(
      result.records.map(job => ({ ...job, ...this.scheduler.recordOf(job.id) })),
      result.total,
      result.current,
      result.size
    )
  }

  /** 导出：与列表同筛选条件，单次最多 5000 条（配置备份/跨环境对照用） */
  async exportJobs(query: QueryJobDto): Promise<JobView[]> {
    const qb = this.jobRepository.createQueryBuilder('job').where('job.del_flag = 0').orderBy('job.create_time', 'DESC').addOrderBy('job.id', 'DESC')
    const keyword = query.keyword?.trim()
    if (keyword) {
      qb.andWhere('(job.job_class_name LIKE :kw OR job.description LIKE :kw)', { kw: `%${keyword}%` })
    }
    if (query.status !== undefined) {
      qb.andWhere('job.status = :status', { status: query.status })
    }
    const jobs = await qb.limit(5000).getMany()
    return jobs.map(job => ({ ...job, ...this.scheduler.recordOf(job.id) }))
  }

  /** 可选执行器清单（前端下拉） */
  listHandlers() {
    return this.registry.list()
  }

  /** 详情（排除已删除） */
  async findDetail(id: string): Promise<JobView> {
    const job = await this.findActive(id)
    return { ...job, ...this.scheduler.recordOf(job.id) }
  }

  /** 创建任务：cron 合法 + 执行器存在 + 类名不重复，创建后按状态挂调度 */
  async createJob(dto: CreateJobDto, operator?: string): Promise<JobView> {
    JobScheduler.assertCron(dto.cronExpression)
    this.assertHandlerExists(dto.jobClassName)
    await this.assertClassNameAvailable(dto.jobClassName)

    const entity = this.jobRepository.create({
      id: randomId32(),
      jobClassName: dto.jobClassName,
      cronExpression: dto.cronExpression,
      parameter: dto.parameter,
      description: dto.description,
      // 新建默认停止，避免误配 cron 后立刻开跑
      status: dto.status ?? -1,
      delFlag: 0,
      createBy: operator,
      createTime: new Date()
    })
    const saved = await this.jobRepository.save(entity)
    this.scheduler.schedule(saved)
    return { ...saved, ...this.scheduler.recordOf(saved.id) }
  }

  /** 更新任务：改动 cron/状态后重新挂调度 */
  async updateJob(id: string, dto: UpdateJobDto, operator?: string): Promise<JobView> {
    const before = await this.findActive(id)
    if (dto.cronExpression) {
      JobScheduler.assertCron(dto.cronExpression)
    }
    if (dto.jobClassName && dto.jobClassName !== before.jobClassName) {
      this.assertHandlerExists(dto.jobClassName)
      await this.assertClassNameAvailable(dto.jobClassName, id)
    }
    await this.jobRepository.update(id, {
      ...dto,
      updateBy: operator,
      updateTime: new Date()
    })
    const after = await this.findActive(id)
    this.scheduler.schedule(after)
    return { ...after, ...this.scheduler.recordOf(after.id) }
  }

  /** 软删除（del_flag=1）并停止调度；JeecgBoot 也是逻辑删除 */
  async deleteJob(id: string): Promise<void> {
    await this.findActive(id)
    await this.jobRepository.update(id, { delFlag: 1, status: -1, updateTime: new Date() })
    this.scheduler.unschedule(id)
  }

  /** 启动任务（status=0） */
  async resume(id: string, operator?: string): Promise<JobView> {
    const job = await this.findActive(id)
    if (!job.cronExpression) {
      throw new BadRequestException('任务未配置 cron 表达式，无法启动')
    }
    JobScheduler.assertCron(job.cronExpression)
    this.assertHandlerExists(job.jobClassName ?? '')
    await this.jobRepository.update(id, { status: 0, updateBy: operator, updateTime: new Date() })
    const after = await this.findActive(id)
    this.scheduler.schedule(after)
    return { ...after, ...this.scheduler.recordOf(after.id) }
  }

  /** 暂停任务（status=-1） */
  async pause(id: string, operator?: string): Promise<JobView> {
    await this.findActive(id)
    await this.jobRepository.update(id, { status: -1, updateBy: operator, updateTime: new Date() })
    this.scheduler.unschedule(id)
    const after = await this.findActive(id)
    return { ...after, ...this.scheduler.recordOf(after.id) }
  }

  /** 立即执行一次（不改变启停状态） */
  async runOnce(id: string): Promise<JobExecutionResult> {
    const job = await this.findActive(id)
    return this.scheduler.runOnce(job)
  }

  /** 取未删除的任务，不存在抛 404 */
  private async findActive(id: string): Promise<SysQuartzJobEntity> {
    const job = await this.jobRepository.findOne({ where: { id, delFlag: 0 } })
    if (!job) {
      throw new NotFoundException('定时任务不存在')
    }
    return job
  }

  /** 执行器必须已在注册表里，否则任务永远执行失败 */
  private assertHandlerExists(className: string): void {
    if (!this.registry.has(className)) {
      const names = this.registry
        .list()
        .map(item => item.className)
        .join(' / ')
      throw new BadRequestException(`执行器「${className}」未注册，可选值：${names}`)
    }
  }

  /** 类名唯一（未删除范围内） */
  private async assertClassNameAvailable(className: string, excludeId?: string): Promise<void> {
    const qb = this.jobRepository.createQueryBuilder('job').where('job.del_flag = 0').andWhere('job.job_class_name = :className', { className })
    if (excludeId) {
      qb.andWhere('job.id <> :excludeId', { excludeId })
    }
    if (await qb.getExists()) {
      throw new BadRequestException(`任务类名「${className}」已存在`)
    }
  }
}
