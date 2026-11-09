import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { BaseService } from '../../../helper/crud/base.service'
import { paginate, type Pagination } from '../../../helper/paginate'
import { applyTenantScope } from '../../../shared/tenant/tenant-scope.util'
import { UserService } from '../../user/user.service'
import { TaskEntity } from './entities/task.entity'

/** 状态机：允许的状态流转 */
const STATUS_TRANSITIONS: Record<number, number[]> = {
  0: [1, 3], // 待处理 → 进行中 / 已取消
  1: [2, 3], // 进行中 → 已完成 / 已取消
  2: [], // 终态
  3: [0] // 已取消 → 可重新打开
}

/** 任务状态中文名（错误信息用） */
const STATUS_LABELS: Record<number, string> = { 0: '待处理', 1: '进行中', 2: '已完成', 3: '已取消' }

/** 未指派的哨兵值：assignee_id 是字符串主键，'0' 表示没有负责人 */
export const TASK_UNASSIGNED = '0'

@Injectable()
export class TaskService extends BaseService<TaskEntity> {
  constructor(
    @InjectRepository(TaskEntity)
    repository: Repository<TaskEntity>,
    private readonly userService: UserService
  ) {
    super(repository, '任务')
  }

  /**
   * 负责人存在性校验
   *
   * assignee_id 已是 varchar(32) 与 sys_user.id 同型，但接口仍可能收到任意字符串。
   * 不校验就会写出「指向不存在用户」的孤儿指派——任务页显示不出负责人，首页待办也统计不到。
   */
  private async assertAssignee(assigneeId?: string | null): Promise<void> {
    if (!assigneeId || assigneeId === TASK_UNASSIGNED) return
    const found = await this.userService.findExistingBriefs([assigneeId])
    if (!found.length) {
      throw new BadRequestException('负责人不存在或已被删除')
    }
  }

  /** 创建：dueDate 字符串转 Date（DTO 层校验 ISO 8601，这里负责转换） */
  async create(dto: Omit<Partial<TaskEntity>, 'dueDate'> & { dueDate?: string }): Promise<TaskEntity> {
    await this.assertAssignee(dto.assigneeId)
    const data = { ...dto, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined } as Partial<TaskEntity>
    return super.create(data)
  }

  /** 更新：同上转换 dueDate */
  async update(id: number, dto: Omit<Partial<TaskEntity>, 'dueDate'> & { dueDate?: string | null }): Promise<TaskEntity> {
    await this.assertAssignee(dto.assigneeId)
    const { dueDate, ...rest } = dto
    const data: Partial<TaskEntity> = { ...rest, dueDate: dueDate === undefined ? undefined : dueDate ? new Date(dueDate) : null }
    return super.update(id, data)
  }

  /** 按状态机流转任务状态（终态/非法流转拒绝） */
  async changeStatus(id: number, status: number): Promise<TaskEntity> {
    const task = await this.findOne(id)
    const allowed = STATUS_TRANSITIONS[task.status] ?? []
    if (!allowed.includes(status)) {
      throw new BadRequestException(`任务不能从「${STATUS_LABELS[task.status] ?? task.status}」变更为「${STATUS_LABELS[status] ?? status}」`)
    }
    return super.update(id, { status })
  }

  /**
   * 批量把 assignee_id 翻译成姓名
   *
   * 走 UserService.lookupBrief（单次上限 100），与列表 pageSize 上限一致。
   * 用户已软删 / ID 拼错时查不到，此时留空，由前端显示「未指派」。
   */
  private async attachAssignees(rows: TaskEntity[]): Promise<void> {
    const ids = Array.from(new Set(rows.map(row => row.assigneeId).filter(id => id && id !== TASK_UNASSIGNED)))
    if (!ids.length) return
    const briefs = await this.userService.lookupBrief(ids)
    const nameById = new Map(briefs.map(b => [b.id, b.realname || b.username]))
    for (const row of rows) {
      row.assigneeName = nameById.get(row.assigneeId)
    }
  }

  /** 分页列表：keyword/priority/status/assigneeId 过滤，records 附带负责人姓名 */
  async listByQuery(query: {
    page?: number
    pageSize?: number
    keyword?: string
    priority?: number
    status?: number
    assigneeId?: string
  }): Promise<Pagination<TaskEntity>> {
    const qb = this.repository.createQueryBuilder('task').orderBy('task.id', 'DESC')
    applyTenantScope(qb, 'task')
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
    const result = await paginate(qb, { page: query.page, pageSize: query.pageSize })
    await this.attachAssignees(result.records)
    return result
  }

  /**
   * 我负责的任务（登录即可用：首页「我的待办」下钻、任务页「只看我的」共用）
   *
   * 刻意**不加租户作用域**：条件就是 assignee_id = 当前登录用户 id（32 位字符串主键，不可伪造），
   * 只会查到自己的活。反过来加隔离会出两种错：
   * 1. 无租户归属的账号（login_tenant_id 为 NULL）上下文按 tenant_id=0 过滤，一条都查不到，
   *    但首页 dashboard.myTasks 走裸 SQL 不隔离 → 卡片显示 3 条、点进去 0 条，自相矛盾；
   * 2. 被指派到其他租户数据上的任务，换个租户视角再看就"消失"了，与「我的待办」语义冲突。
   */
  async mine(userId: string, query: { page?: number; pageSize?: number; status?: number }): Promise<Pagination<TaskEntity>> {
    const qb = this.repository.createQueryBuilder('task').where('task.assigneeId = :assigneeId', { assigneeId: userId }).orderBy('task.id', 'DESC')
    if (query.status !== undefined) {
      qb.andWhere('task.status = :status', { status: query.status })
    }
    const result = await paginate(qb, { page: query.page, pageSize: query.pageSize })
    await this.attachAssignees(result.records)
    return result
  }
}
