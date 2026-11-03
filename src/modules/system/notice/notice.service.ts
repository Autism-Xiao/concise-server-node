import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { BaseService } from '../../../helper/crud/base.service'
import { paginate, type Pagination } from '../../../helper/paginate'
import { NoticeEntity } from './entities/notice.entity'

@Injectable()
export class NoticeService extends BaseService<NoticeEntity> {
  constructor(
    @InjectRepository(NoticeEntity)
    repository: Repository<NoticeEntity>
  ) {
    super(repository, '公告')
  }

  /** 创建：status=1 时直接发布并写发布时间 */
  async create(dto: Partial<NoticeEntity>): Promise<NoticeEntity> {
    if (dto.status === 1) {
      dto.publishedAt = new Date()
    }
    return super.create(dto)
  }

  /** 更新：草稿 → 发布时补写发布时间；发布 → 草稿时清空 */
  async update(id: number, dto: Partial<NoticeEntity>): Promise<NoticeEntity> {
    if (dto.status === 1) {
      const current = await this.findOne(id)
      dto.publishedAt = current.publishedAt ?? new Date()
    } else if (dto.status === 0) {
      dto.publishedAt = null
    }
    return super.update(id, dto)
  }

  /** 发布 */
  async publish(id: number): Promise<NoticeEntity> {
    return super.update(id, { status: 1, publishedAt: new Date() })
  }

  /** 撤回（回草稿箱） */
  async unpublish(id: number): Promise<NoticeEntity> {
    return super.update(id, { status: 0, publishedAt: null })
  }

  /** 管理端分页：keyword/type/status 过滤 */
  async listByQuery(query: { page?: number; pageSize?: number; keyword?: string; type?: number; status?: number }): Promise<Pagination<NoticeEntity>> {
    const qb = this.repository.createQueryBuilder('notice').orderBy('notice.id', 'DESC')
    if (query.keyword) {
      qb.andWhere('notice.title LIKE :keyword', { keyword: `%${query.keyword}%` })
    }
    if (query.type !== undefined) {
      qb.andWhere('notice.type = :type', { type: query.type })
    }
    if (query.status !== undefined) {
      qb.andWhere('notice.status = :status', { status: query.status })
    }
    return paginate(qb, { page: query.page, pageSize: query.pageSize })
  }

  /** 普通用户端：仅已发布公告，置顶最新 */
  async listPublished(query: { page?: number; pageSize?: number; type?: number }): Promise<Pagination<NoticeEntity>> {
    const qb = this.repository.createQueryBuilder('notice').where('notice.status = 1').orderBy('notice.publishedAt', 'DESC')
    if (query.type !== undefined) {
      qb.andWhere('notice.type = :type', { type: query.type })
    }
    return paginate(qb, { page: query.page, pageSize: query.pageSize })
  }
}
