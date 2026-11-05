import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, type SelectQueryBuilder } from 'typeorm'

import { BaseService } from '../../../helper/crud/base.service'
import { paginate, type Pagination } from '../../../helper/paginate'
import { UserEntity } from '../../user/entities/user.entity'
import { SysAnnouncementEntity } from './entities/sys-announcement.entity'
import type { CreateNoticeDto } from './dto/create-notice.dto'
import type { QueryNoticeDto } from './dto/query-notice.dto'
import type { UpdateNoticeDto } from './dto/update-notice.dto'

/** 单次导入上限（行） */
export const NOTICE_IMPORT_MAX_ROWS = 1000
/** 导入文件大小上限（5MB，与用户/角色导入保持一致） */
export const NOTICE_IMPORT_MAX_SIZE = 5 * 1024 * 1024

/** 导入字段：用于按表头别名定位列，列顺序无关 */
type NoticeImportField = 'id' | 'title' | 'msgCategory' | 'priority' | 'sendStatus' | 'msgType' | 'userIds' | 'startTime' | 'endTime' | 'msgContent'

/** 表头别名：用户手改表头也能认出来（模板里用的是第一个） */
const NOTICE_IMPORT_ALIASES: Record<NoticeImportField, string[]> = {
  id: ['编号', 'id', '公告id'],
  title: ['标题', '公告标题', 'title'],
  msgCategory: ['类型', '消息类型', 'msgcategory'],
  priority: ['优先级', 'priority'],
  sendStatus: ['状态', '发布状态', 'sendstatus'],
  msgType: ['通告对象', '对象类型', 'msgtype'],
  userIds: ['指定用户', '指定用户账号', '接收人', 'userids'],
  startTime: ['生效开始', '开始时间', 'starttime'],
  endTime: ['生效结束', '结束时间', 'endtime'],
  msgContent: ['内容', '公告内容', 'msgcontent']
}

/** 文本 → 枚举：中英文与数字都认，认不出返回 undefined 由调用方报错 */
const CATEGORY_BY_TEXT: Record<string, string> = { 通知公告: '1', 公告: '1', 通知: '1', '1': '1', 系统消息: '2', 系统: '2', '2': '2' }
const PRIORITY_BY_TEXT: Record<string, string> = { 高: 'H', h: 'H', 中: 'M', m: 'M', 低: 'L', l: 'L' }
const STATUS_BY_TEXT: Record<string, string> = { 未发布: '0', 草稿: '0', '0': '0', 已发布: '1', 发布: '1', '1': '1', 已撤销: '2', 撤销: '2', '2': '2' }
const TARGET_BY_TEXT: Record<string, string> = { 全体用户: 'ALL', 全体: 'ALL', 全员: 'ALL', all: 'ALL', 指定用户: 'USER', 指定: 'USER', user: 'USER' }

/** 导入失败明细：row 是 Excel 真实行号，title 便于用户对照 */
export interface NoticeImportError {
  row: number
  title: string
  message: string
}

/** 导入结果：逐行统计 + 失败明细（前端据此展示导入报告） */
export interface NoticeImportResult {
  total: number
  created: number
  updated: number
  /** 跳过行数（同一份文件内标题重复） */
  skipped: number
  failed: number
  errors: NoticeImportError[]
}

/**
 * 解析日期时间单元格
 * - 支持 2026-01-01、2026-01-01 08:00、2026/01/01、ISO 8601
 * - 无法识别返回 null，由调用方按「该行失败」处理（不静默当空值）
 */
function parseDateTimeCell(raw: string): Date | null {
  const text = raw.trim().replace(/\//g, '-')
  if (!text) {
    return null
  }
  const normalized = text.includes(' ') ? text.replace(' ', 'T') : `${text}T00:00:00`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

/** 多值分隔：公告的指定用户可能从 Excel 里粘进来，分隔符五花八门 */
const MULTI_VALUE_SEPARATOR = /[/,、;|]/

/** 空串转 undefined，避免把 NULL 写成空字符串 */
function blankToUndefined(value: string): string | undefined {
  return value ? value : undefined
}

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
    private readonly announcementRepository: Repository<SysAnnouncementEntity>,
    /** 导入「指定用户」列要按账号解析成 userIds，故这里直连用户表（本模块 forFeature 已注册） */
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>
  ) {
    super(announcementRepository, '公告')
  }

  /** 管理端分页：keyword 匹配标题/内容，可按类型/状态/优先级/创建时间过滤 */
  async listByQuery(query: QueryNoticeDto): Promise<Pagination<SysAnnouncementEntity>> {
    return paginate(this.buildListQuery(query), { page: query.page, pageSize: query.pageSize })
  }

  /** 列表查询：过滤条件集中一处，列表与后续扩展复用同一口径 */
  private buildListQuery(query: QueryNoticeDto): SelectQueryBuilder<SysAnnouncementEntity> {
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
    return qb
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
   * 导入公告（.xlsx / .csv 解析后的二维数组 + 表头真实行号）
   * - 匹配方式：默认按「标题」精确匹配（大小写不敏感）；若文件里带「编号」列，则优先按 id 精确命中
   * - 更新时只覆盖填了值的列：内容/时间留空表示不改，状态留空表示保持原状态
   * - 状态填「已发布」且原来不是已发布 → 视为发布，自动补发布时间与发布人；填「未发布」会清空发布痕迹
   * - 「指定用户」列填账号（多个用 , / 、 ; 分隔），解析不到账号直接判该行失败，不静默丢人
   * - 单行失败不影响其他行，逐行统计返回；row 为 Excel 真实行号
   */
  async importNotices(rows: string[][], headerRowNumber = 1, operator?: string): Promise<NoticeImportResult> {
    if (!rows.length) {
      throw new BadRequestException('文件内容为空，请下载模板后填写')
    }
    const { columns, dataRows } = this.resolveImportColumns(rows, headerRowNumber)
    if (columns.title === undefined) {
      throw new BadRequestException('未找到「标题」列，请使用导入模板的表头')
    }
    if (!dataRows.length) {
      throw new BadRequestException('表头下方没有数据行，请填写后再导入')
    }
    if (dataRows.length > NOTICE_IMPORT_MAX_ROWS) {
      throw new BadRequestException(`单次最多导入 ${NOTICE_IMPORT_MAX_ROWS} 行，当前 ${dataRows.length} 行，请拆分后重试`)
    }

    const [existing, users] = await Promise.all([
      this.announcementRepository.find({ where: { delFlag: '0' } }),
      this.userRepository.find({ where: { delFlag: 0 }, select: { id: true, username: true, realname: true } })
    ])
    const byId = new Map(existing.map(item => [item.id.toLowerCase(), item]))
    const byTitle = new Map(existing.map(item => [item.title.trim().toLowerCase(), item]))
    const userByName = new Map<string, UserEntity>()
    for (const user of users) {
      userByName.set(user.username.toLowerCase(), user)
      if (user.realname) {
        userByName.set(user.realname.toLowerCase(), user)
      }
    }

    const seenTitles = new Set<string>()
    const result: NoticeImportResult = { total: dataRows.length, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] }

    /** 读取某列文本（列不存在时返回空串） */
    const pick = (cells: string[], field: NoticeImportField): string => {
      const index = columns[field]
      return index === undefined ? '' : (cells[index] ?? '').trim()
    }

    for (const { rowNumber, cells } of dataRows) {
      const title = pick(cells, 'title')
      const fail = (message: string) => {
        result.failed += 1
        result.errors.push({ row: rowNumber, title, message })
      }

      if (!title) {
        fail('标题不能为空')
        continue
      }
      if (title.length > 100) {
        fail('标题不能超过 100 个字符')
        continue
      }
      const titleKey = title.toLowerCase()
      if (seenTitles.has(titleKey)) {
        result.skipped += 1
        result.errors.push({ row: rowNumber, title, message: '文件内标题重复，本行已跳过（同一条公告只能出现一次）' })
        continue
      }
      seenTitles.add(titleKey)

      // ---- 枚举列：留空表示不改（新增时用默认值） ----
      const categoryText = pick(cells, 'msgCategory')
      const msgCategory = categoryText ? CATEGORY_BY_TEXT[categoryText.toLowerCase()] : undefined
      if (categoryText && !msgCategory) {
        fail('类型请填「通知公告」或「系统消息」')
        continue
      }
      const priorityText = pick(cells, 'priority')
      const priority = priorityText ? PRIORITY_BY_TEXT[priorityText.toLowerCase()] : undefined
      if (priorityText && !priority) {
        fail('优先级请填「高」「中」「低」')
        continue
      }
      const statusText = pick(cells, 'sendStatus')
      const sendStatus = statusText ? STATUS_BY_TEXT[statusText.toLowerCase()] : undefined
      if (statusText && !sendStatus) {
        fail('状态请填「未发布」「已发布」或「已撤销」')
        continue
      }
      const targetText = pick(cells, 'msgType')
      let msgType = targetText ? TARGET_BY_TEXT[targetText.toLowerCase()] : undefined
      if (targetText && !msgType) {
        fail('通告对象请填「全体用户」或「指定用户」')
        continue
      }

      // ---- 时间列：填了就必须能解析，避免把 2026-13-01 静默当空 ----
      const startRaw = pick(cells, 'startTime')
      const startTime = startRaw ? parseDateTimeCell(startRaw) : null
      if (startRaw && !startTime) {
        fail(`生效开始「${startRaw}」不是有效日期，请用 2026-01-01 或 2026-01-01 08:00 格式`)
        continue
      }
      const endRaw = pick(cells, 'endTime')
      const endTime = endRaw ? parseDateTimeCell(endRaw) : null
      if (endRaw && !endTime) {
        fail(`生效结束「${endRaw}」不是有效日期，请用 2026-01-01 或 2026-01-01 08:00 格式`)
        continue
      }
      if (startTime && endTime && startTime > endTime) {
        fail('生效开始时间不能晚于生效结束时间')
        continue
      }

      // ---- 指定用户：账号或姓名 → id，找不到就整行失败 ----
      const userText = pick(cells, 'userIds')
      const userIds: string[] = []
      if (userText) {
        const tokens = userText
          .split(MULTI_VALUE_SEPARATOR)
          .map(token => token.trim())
          .filter(Boolean)
        const missing: string[] = []
        for (const token of tokens) {
          const matched = userByName.get(token.toLowerCase())
          if (!matched) {
            missing.push(token)
          } else if (!userIds.includes(matched.id)) {
            userIds.push(matched.id)
          }
        }
        if (missing.length) {
          fail(`指定用户不存在：${missing.join('、')}（请填登录账号或姓名）`)
          continue
        }
        // 填了人却没写通告对象，按「指定用户」处理，避免公告发给全员
        msgType = msgType ?? 'USER'
      }
      if (msgType === 'USER' && !userIds.length) {
        fail('通告对象为「指定用户」时必须填写指定用户账号')
        continue
      }

      const msgContent = pick(cells, 'msgContent')
      const idText = pick(cells, 'id').toLowerCase()
      const current = (idText ? byId.get(idText) : undefined) ?? byTitle.get(titleKey)

      try {
        if (current) {
          // ---- 更新：只覆盖填了值的列 ----
          const patch: Record<string, unknown> = { updateBy: operator, updateTime: new Date() }
          if (title !== current.title) {
            patch.title = title
          }
          if (msgContent) {
            patch.msgContent = msgContent
          }
          if (msgCategory) {
            patch.msgCategory = msgCategory
          }
          if (msgType) {
            patch.msgType = msgType
          }
          if (priority) {
            patch.priority = priority
          }
          if (startRaw) {
            patch.startTime = startTime
          }
          if (endRaw) {
            patch.endTime = endTime
          }
          if (userText) {
            patch.userIds = userIds.join(',')
          }
          if (sendStatus && sendStatus !== current.sendStatus) {
            patch.sendStatus = sendStatus
            if (sendStatus === '1') {
              // 切到已发布：补发布时间与发布人，清撤销时间（与 updateNotice 口径一致）
              patch.sendTime = new Date()
              patch.sender = operator ?? current.sender
              patch.cancelTime = null
            } else if (sendStatus === '0') {
              patch.sendTime = null
              patch.cancelTime = null
            } else {
              patch.cancelTime = new Date()
            }
          }
          await this.patchById(current.id, patch)
          // 更新后同步两个索引，保证同一份文件里后续行能命中最新标题
          byTitle.delete(current.title.trim().toLowerCase())
          byTitle.set(titleKey, { ...current, title })
          result.updated += 1
        } else {
          // ---- 新增：未填的状态按「未发布」处理（不会因为一个空格把公告发出去） ----
          const publish = sendStatus === '1'
          const created = await this.create({
            title,
            msgContent: blankToUndefined(msgContent),
            msgCategory: msgCategory ?? '1',
            msgType: msgType ?? 'ALL',
            priority: priority ?? 'M',
            sendStatus: sendStatus ?? '0',
            sender: publish ? operator : undefined,
            sendTime: publish ? new Date() : undefined,
            cancelTime: sendStatus === '2' ? new Date() : undefined,
            startTime: startTime ?? undefined,
            endTime: endTime ?? undefined,
            userIds: userIds.length ? userIds.join(',') : undefined,
            delFlag: '0',
            createBy: operator,
            createTime: new Date()
          })
          byId.set(created.id.toLowerCase(), created)
          byTitle.set(titleKey, created)
          result.created += 1
        }
      } catch (error) {
        const raw = error instanceof Error ? error.message : ''
        fail(raw || '写入失败')
      }
    }

    return result
  }

  /** 解析导入文件的列位置：按表头别名定位，未命中「标题」由调用方报错 */
  private resolveImportColumns(
    rows: string[][],
    headerRowNumber = 1
  ): { columns: Partial<Record<NoticeImportField, number>>; dataRows: Array<{ rowNumber: number; cells: string[] }> } {
    // 表头可能带必填标记（「标题 *」）或前后空格，归一化后再比较
    const header = rows[0].map(cell => cell.replace(/[\s*＊]/g, '').toLowerCase())
    const columns: Partial<Record<NoticeImportField, number>> = {}
    for (const field of Object.keys(NOTICE_IMPORT_ALIASES) as NoticeImportField[]) {
      const index = header.findIndex(cell => NOTICE_IMPORT_ALIASES[field].includes(cell))
      if (index >= 0) {
        columns[field] = index
      }
    }
    const dataRows = rows.slice(1).map((cells, index) => ({ rowNumber: headerRowNumber + index + 1, cells }))
    return { columns, dataRows }
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
