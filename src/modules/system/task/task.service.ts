import { Injectable, BadRequestException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { BaseService } from '../../../helper/crud/base.service'
import { paginate, type Pagination } from '../../../helper/paginate'
import { TaskEntity } from './entities/task.entity'

/** 状态机：允许的状态流转 */
const STATUS_TRANSITIONS: Record<number, number[]> = {
  0: [1, 3], // 待处理 → 进行中 / 已取消
  1: [2, 3], // 进行中 → 已完成 / 已取消
  2: [], // 终态
  3: [0] // 已取消 → 可重新打开
}

@Injectable()
export class TaskService extends BaseService<TaskEntity> {
  constructor(
    @InjectRepository(TaskEntity)
    repository: Repository<TaskEntity>
  ) {
    super(repository, '任务')
  }

  /** 创建：dueDate 字符串转 Date（DTO 层校验 ISO 8601，这里负责转换） */
  async create(dto: Omit<Partial<TaskEntity>, 'dueDate'> & { dueDate?: string }): Promise<TaskEntity> {
    const data = { ...dto, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined } as Partial<TaskEntity>
    return super.create(data)
  }

  /** 更新：同上转换 dueDate */
  async update(id: number, dto: Omit<Partial<TaskEntity>, 'dueDate'> & { dueDate?: string | null }): Promise<TaskEntity> {
    const { dueDate, ...rest } = dto
    const data: Partial<TaskEntity> = { ...rest, dueDate: dueDate === undefined ? undefined : dueDate ? new Date(dueDate) : null }
    return super.update(id, data)
  }

  /** 按状态机流转任务状态（终态/非法流转拒绝） */
  async changeStatus(id: number, status: number): Promise<TaskEntity> {
    const task = await this.findOne(id)
    const allowed = STATUS_TRANSITIONS[task.status] ?? []
    if (!allowed.includes(status)) {
      const labels: Record<number, string> = { 0: '待处理', 1: '进行中', 2: '已完成', 3: '已取消' }
      throw new BadRequestException(`任务不能从「${labels[task.status]}」变更为「${labels[status] ?? status}」`)
    }
    return super.update(id, { status })
  }

  /** 分页列表：keyword/priority/status/assigneeId 过滤 */
  async listByQuery(query: {
    page?: number
    pageSize?: number
    keyword?: string
    priority?: number
    status?: number
    assigneeId?: number
  }): Promise<Pagination<TaskEntity>> {
    const qb = this.repository.createQueryBuilder('task').orderBy('task.id', 'DESC')
    if (query.keyword) {
      qb.andWhere('task.title LIKE :keyword', { keyword: `%${query.keyword}%` })
    }
    if (query.priority !== undefined) {
      qb.andWhere('task.priority = :priority', { priority: query.priority })
    }
    if (query.status !== undefined) {
      qb.andWhere('task.status = :status', { status: query.status })
    }
    if (query.assigneeId !== undefined && query.assigneeId !== null) {
      qb.andWhere('task.assigneeId = :assigneeId', { assigneeId: query.assigneeId })
    }
    return paginate(qb, { page: query.page, pageSize: query.pageSize })
  }
}
