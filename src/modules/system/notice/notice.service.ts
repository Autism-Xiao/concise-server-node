import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { BaseService } from '../../../helper/crud/base.service'
import { paginate, type Pagination } from '../../../helper/paginate'
import { SysAnnouncementEntity } from './entities/sys-announcement.entity'
import type { CreateNoticeDto } from './dto/create-notice.dto'
import type { QueryNoticeDto } from './dto/query-notice.dto'
import type { UpdateNoticeDto } from './dto/update-notice.dto'

/**
 * 通知公告服务（表 sys_announcement，对齐 JeecgBoot）
 *
 * 状态语义（JeecgBoot）：send_status '0' 未发布 / '1' 已发布 / '2' 已撤销；
 * 删除为软删（del_flag '1'），所有查询默认排除已删除。
 */
@Injectable()
export class NoticeService extends BaseService<SysAnnouncementEntity> {
  constructor(
    @InjectRepository(SysAnnouncementEntity)
    private readonly announcementRepository: Repository<SysAnnouncementEntity>
  ) {
    super(announcementRepository, '公告')
  }

  /** 管理端分页：keyword 匹配标题/内容，可按类型/状态/优先级/创建时间过滤 */
  async listByQuery(query: QueryNoticeDto): Promise<Pagination<SysAnnouncementEntity>> {
    const qb = this.announcementRepository
      .createQueryBuilder('n')
      .where('n.del_flag = :delFlag', { delFlag: '0' })
      .orderBy('n.create_time', 'DESC')
      .addOrderBy('n.id', 'DESC')

    const keyword = query.keyword?.trim()
    if (keyword) {
      qb.andWhere('(n.titile LIKE :kw OR n.msg_content LIKE :kw)', { kw: `%${keyword}%` })
    }
    if (query.msgCategory) {
      qb.andWhere('n.msg_category = :msgCategory', { msgCategory: query.msgCategory })
    }
    if (query.sendStatus) {
      qb.andWhere('n.send_status = :sendStatus', { sendStatus: query.sendStatus })
    }
    if (query.priority) {
      qb.andWhere('n.priority = :priority', { priority: query.priority })
    }
    if (query.startTime) {
      qb.andWhere('n.create_time >= :startTime', { startTime: query.startTime })
    }
    if (query.endTime) {
      qb.andWhere('n.create_time <= :endTime', { endTime: query.endTime })
    }
    return paginate(qb, { page: query.page, pageSize: query.pageSize })
  }

  /**
   * 全员可见列表：未删除 + 已发布，并排除未到生效期或已过期的公告
   * （start_time/end_time 为空表示不限）
   */
  async listPublished(query: { page?: number; pageSize?: number; msgCategory?: string }): Promise<Pagination<SysAnnouncementEntity>> {
    const qb = this.announcementRepository
      .createQueryBuilder('n')
      .where('n.del_flag = :delFlag', { delFlag: '0' })
      .andWhere("n.send_status = '1'")
      .andWhere('(n.start_time IS NULL OR n.start_time <= NOW())')
      .andWhere('(n.end_time IS NULL OR n.end_time >= NOW())')
      .orderBy('n.send_time', 'DESC')
      .addOrderBy('n.id', 'DESC')
    if (query.msgCategory) {
      qb.andWhere('n.msg_category = :msgCategory', { msgCategory: query.msgCategory })
    }
    return paginate(qb, { page: query.page, pageSize: query.pageSize })
  }

  /** 详情：默认只看未删除记录 */
  async findOneActive(id: string): Promise<SysAnnouncementEntity> {
    const notice = await this.announcementRepository.findOne({ where: { id, delFlag: '0' } })
    if (!notice) {
      throw new NotFoundException('公告不存在')
    }
    return notice
  }

  /** 创建：sendStatus=1 时直接发布并落 send_time/sender；其余字段补 jeecg 默认值 */
  async createNotice(dto: CreateNoticeDto, operator?: string): Promise<SysAnnouncementEntity> {
    const { startTime, endTime, ...rest } = dto
    const publish = rest.sendStatus === '1'
    return this.create({
      ...rest,
      msgCategory: rest.msgCategory ?? '1',
      msgType: rest.msgType ?? 'ALL',
      priority: rest.priority ?? 'M',
      sendStatus: publish ? '1' : '0',
      sender: publish ? operator : undefined,
      sendTime: publish ? new Date() : undefined,
      startTime: startTime ? new Date(startTime) : undefined,
      endTime: endTime ? new Date(endTime) : undefined,
      delFlag: '0',
      createBy: operator,
      createTime: new Date()
    })
  }

  /** 更新：状态切到已发布时补 send_time/sender 并清撤销时间；显式回退到未发布时清发布痕迹 */
  async updateNotice(id: string, dto: UpdateNoticeDto, operator?: string): Promise<SysAnnouncementEntity> {
    const before = await this.findOneActive(id)
    const { startTime, endTime, ...rest } = dto
    const patch: Record<string, unknown> = {
      ...rest,
      updateBy: operator,
      updateTime: new Date()
    }
    if (startTime !== undefined) {
      patch.startTime = startTime ? new Date(startTime) : null
    }
    if (endTime !== undefined) {
      patch.endTime = endTime ? new Date(endTime) : null
    }
    if (rest.sendStatus === '1' && before.sendStatus !== '1') {
      patch.sendTime = new Date()
      patch.sender = operator ?? before.sender
      patch.cancelTime = null
    } else if (rest.sendStatus === '0' && before.sendStatus !== '0') {
      // 撤销/发布后手动改回未发布：清掉发布时间与撤销时间，回到草稿语义
      patch.sendTime = null
      patch.cancelTime = null
    }
    await this.patchById(id, patch)
    return this.findOneActive(id)
  }

  /** 发布（已发布则报错，避免重复刷新发布时间） */
  async publish(id: string, operator?: string): Promise<SysAnnouncementEntity> {
    const before = await this.findOneActive(id)
    if (before.sendStatus === '1') {
      throw new BadRequestException('该公告已发布，无需重复发布')
    }
    await this.patchById(id, {
      sendStatus: '1',
      sendTime: new Date(),
      cancelTime: null,
      sender: operator ?? before.sender ?? null,
      updateBy: operator,
      updateTime: new Date()
    })
    return this.findOneActive(id)
  }

  /** 撤销（仅已发布可撤销），记录撤销时间 */
  async revoke(id: string, operator?: string): Promise<SysAnnouncementEntity> {
    const before = await this.findOneActive(id)
    if (before.sendStatus !== '1') {
      throw new BadRequestException('只有已发布的公告才能撤销')
    }
    await this.patchById(id, {
      sendStatus: '2',
      cancelTime: new Date(),
      updateBy: operator,
      updateTime: new Date()
    })
    return this.findOneActive(id)
  }

  /** 删除：软删（del_flag=1）；已发布的需先撤销，避免线上公告突然消失 */
  override async delete(id: string): Promise<void> {
    const before = await this.findOneActive(id)
    if (before.sendStatus === '1') {
      throw new BadRequestException('已发布的公告不能直接删除，请先撤销')
    }
    await this.patchById(id, { delFlag: '1', updateTime: new Date() })
  }

  /**
   * 按 id 更新指定列
   * 用 QueryBuilder 而非 repository.update：后者会跳过 undefined、也不接受 null，
   * 而"清空发布时间/撤销时间"必须真的写 NULL
   */
  private async patchById(id: string, patch: Record<string, unknown>): Promise<void> {
    await this.announcementRepository
      .createQueryBuilder()
      .update(SysAnnouncementEntity)
      .set(patch as never)
      .where('id = :id', { id })
      .execute()
  }
}
