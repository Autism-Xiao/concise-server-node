import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, LessThan, Repository } from 'typeorm'

import { paginate, type Pagination } from '../../../helper/paginate'
import { applyTenantScope } from '../../../shared/tenant/tenant-scope.util'
import { getExtname, sanitizeFileName } from '../../../utils/file.util'
import { detectImageSignature } from '../../../utils/image-signature.util'
import { FileEntity } from './entities/file.entity'
import type { CreateFolderDto } from './dto/create-folder.dto'
import type { FileKind, QueryFileDto } from './dto/query-file.dto'
import type { UpdateFileDto } from './dto/update-file.dto'
import type { UploadFileDto } from './dto/upload-file.dto'

/** 根目录的 parentId 固定为 0 */
export const FILE_ROOT_ID = 0
/** 目录最大层级（防脏数据形成超深链，也防上溯死循环） */
const FILE_MAX_DEPTH = 32

/**
 * 物理存储根目录：刻意不放在 public/ 下
 * —— public 是静态托管的，用户传个 .html 就能同源执行脚本（读 localStorage 里的 token）。
 * 这里用函数而不是模块级常量：模块 import 早于 ConfigModule 加载 .env，顶层取值会拿不到配置。
 */
function storageRoot(): string {
  return process.env.FILE_STORAGE_DIR?.trim() || path.join(process.cwd(), 'storage/files')
}

/** 每个用户的默认配额（MB），超出即拒绝上传；同样惰性读取环境变量 */
export function fileQuotaBytes(): number {
  return Number(process.env.FILE_QUOTA_MB ?? 2048) * 1024 * 1024
}

/**
 * 上传临时目录：与存储目录同盘，multer 落盘后 rename 才是毫秒级。
 * 控制器（multer diskStorage）与清理任务共用这个入口，别在两处各写一份默认值。
 */
export function fileTempDir(): string {
  return process.env.FILE_TEMP_DIR?.trim() || path.join(process.cwd(), 'storage/tmp')
}

/** 回收站保留天数（默认 30 天，<=0 表示不自动清理 —— 交给人工彻底删除） */
export function recycleRetentionDays(): number {
  const days = Number(process.env.FILE_RECYCLE_DAYS ?? 30)
  return Number.isFinite(days) ? days : 30
}

/** 临时文件保留小时数（默认 24 小时，<=0 表示不清理） */
export function tempRetentionHours(): number {
  const hours = Number(process.env.FILE_TMP_HOURS ?? 24)
  return Number.isFinite(hours) ? hours : 24
}

/** 分类 → 扩展名集合（other 走反向排除，避免漏掉新类型） */
const KIND_EXTENSIONS: Record<Exclude<FileKind, 'all' | 'other'>, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tif', 'tiff', 'psd', 'heic'],
  document: ['txt', 'md', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'rtf', 'odt', 'ods', 'odp', 'pages', 'numbers'],
  video: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm', 'm4v', 'mpg', 'mpeg', 'rmvb'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'ape']
}

const ALL_KNOWN_EXTENSIONS = Object.values(KIND_EXTENSIONS).flat()

/** 可在线预览的位图扩展名（SVG 刻意排除：XML 文本能内嵌脚本，inline 渲染等于同源 XSS） */
const PREVIEW_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']

/** 可 inline 返回的纯文本类型（配 text/plain + nosniff，浏览器不会当 HTML 执行） */
const PREVIEW_TEXT_EXTENSIONS = ['txt', 'md', 'json', 'csv', 'log', 'yml', 'yaml', 'xml', 'ini', 'conf']

/** 常见扩展名 → MIME（下载头用；不在表里的一律 application/octet-stream） */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg'
}

/** 上传结果：skip 策略下 skipped=true 且不返回文件 */
export interface UploadResult {
  skipped: boolean
  file?: FileEntity
  message: string
}

/** 存储用量统计（前端存储卡数据源） */
export interface FileStats {
  totalBytes: number
  fileCount: number
  folderCount: number
  quotaBytes: number
  byKind: Array<{ kind: FileKind; label: string; bytes: number; count: number }>
}

const KIND_LABELS: Record<Exclude<FileKind, 'all'>, string> = {
  image: '图片',
  document: '文档',
  video: '视频',
  audio: '音频',
  other: '其他'
}

/**
 * 文件管理服务（个人空间，按 ownerId 隔离）
 *
 * 三个核心约定：
 * 1. **逻辑目录与物理文件解耦** —— 改名/移动只改 sys_file，磁盘上按 sha256 内容寻址，一份内容只存一次；
 * 2. **所有查询都带 ownerId** —— 避免改个 id 就能下载别人的文件（IDOR）；
 * 3. **删除是软删** —— 进回收站，彻底删才清物理文件（且要确认没有别处还在引用同一份内容）。
 */
@Injectable()
export class FileService {
  constructor(
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>
  ) {}

  /** 当前目录列表：文件夹优先，再按 sort 排；支持名称搜索、分类过滤、只看星标（星标视图跨目录） */
  async list(ownerId: string, query: QueryFileDto): Promise<Pagination<FileEntity>> {
    const qb = this.fileRepository.createQueryBuilder('f').where('f.owner_id = :ownerId', { ownerId }).andWhere('f.is_deleted = 0')
    applyTenantScope(qb, 'f')

    // 星标是「跨目录」视图（相当于网盘的收藏夹），其余情况只看当前目录
    if (!query.starred) {
      qb.andWhere('f.parent_id = :parentId', { parentId: query.parentId ?? FILE_ROOT_ID })
    }

    const keyword = query.keyword?.trim()
    if (keyword) {
      qb.andWhere('f.name LIKE :keyword', { keyword: `%${keyword}%` })
    }
    if (query.starred) {
      qb.andWhere('f.is_starred = 1')
    }
    const kind = query.kind ?? 'all'
    if (kind !== 'all') {
      if (kind === 'other') {
        qb.andWhere('f.ext NOT IN (:...knownExt)', { knownExt: ALL_KNOWN_EXTENSIONS })
      } else {
        qb.andWhere('f.ext IN (:...exts)', { exts: KIND_EXTENSIONS[kind] })
      }
      // 分类过滤时文件夹不参与（文件夹没有扩展名）
      qb.andWhere('f.is_folder = 0')
    }

    const direction = query.order === 'asc' ? 'ASC' : 'DESC'
    qb.orderBy('f.is_folder', 'DESC')
    if (query.sort === 'name') {
      qb.addOrderBy('f.name', direction)
    } else if (query.sort === 'size') {
      qb.addOrderBy('f.size', direction)
    } else {
      qb.addOrderBy('f.update_time', direction)
    }
    qb.addOrderBy('f.id', 'DESC')

    return paginate(qb, { page: query.page, pageSize: query.pageSize ?? 20 })
  }

  /** 面包屑：从根到当前目录的链路，第一项固定是「全部文件」(id=0) */
  async breadcrumb(ownerId: string, folderId: number): Promise<Array<{ id: number; name: string }>> {
    const trail: Array<{ id: number; name: string }> = [{ id: FILE_ROOT_ID, name: '全部文件' }]
    if (!folderId) return trail

    const chain: Array<{ id: number; name: string }> = []
    let currentId = folderId
    for (let depth = 0; depth < FILE_MAX_DEPTH && currentId !== FILE_ROOT_ID; depth++) {
      const folder = await this.fileRepository.findOne({ where: { id: currentId, ownerId, isDeleted: 0 } })
      if (!folder) break
      chain.unshift({ id: folder.id, name: folder.name })
      currentId = folder.parentId
    }
    return [...trail, ...chain]
  }

  /** 新建文件夹：同目录下不允许重名（文件与文件夹同名也算冲突，和真实文件系统一致） */
  async createFolder(ownerId: string, dto: CreateFolderDto): Promise<FileEntity> {
    const parentId = dto.parentId ?? FILE_ROOT_ID
    await this.assertFolderExists(ownerId, parentId)
    const name = dto.name.trim()
    await this.assertNameFree(ownerId, parentId, name)

    return this.fileRepository.save(
      this.fileRepository.create({
        parentId,
        name,
        isFolder: 1,
        ext: '',
        mime: '',
        size: 0,
        storageKey: '',
        hash: '',
        ownerId,
        deptId: 0,
        isStarred: 0,
        isDeleted: 0,
        sortOrder: 0,
        remark: '',
        createTime: new Date(),
        updateTime: new Date()
      })
    )
  }

  /**
   * 上传文件
   *
   * 顺序很关键：先校验目录 → 再算 hash → 配额 → 冲突策略 → 落盘 → 写库。
   * 落盘用内容寻址（相同 sha256 复用已有物理文件），所以「上传一份已存在的文件」只花一次磁盘。
   *
   * 大文件不走内存：multer 配的是 diskStorage，file.path 是临时文件，
   * 这里边读边算 sha256，最后 rename 到内容地址（同盘 rename 是毫秒级）。
   */
  async upload(ownerId: string, file: Express.Multer.File | undefined, dto: UploadFileDto): Promise<UploadResult> {
    const tempPath = file?.path
    try {
      if (!file || (!file.buffer?.length && !tempPath)) {
        throw new BadRequestException('未收到上传文件')
      }
      const parentId = dto.parentId ?? FILE_ROOT_ID
      await this.assertFolderExists(ownerId, parentId)

      const originalName = this.decodeOriginalName(file.originalname)
      const safeName = this.truncateName(sanitizeFileName(originalName))
      const ext = this.normalizeExt(getExtname(safeName))
      const size = file.size
      const hash = tempPath ? await this.hashFile(tempPath) : crypto.createHash('sha256').update(file.buffer).digest('hex')

      // 冲突先判：skip 直接返回（不必算配额）；overwrite 的配额增量要扣掉被替换文件的大小
      const existing = await this.fileRepository.findOne({ where: { ownerId, parentId, name: safeName, isDeleted: 0 } })
      let name = safeName
      let overwriting: FileEntity | null = null
      if (existing) {
        const mode = dto.onConflict ?? 'rename'
        if (mode === 'skip') {
          return { skipped: true, message: `「${safeName}」已存在，已跳过` }
        }
        if (mode === 'overwrite') {
          overwriting = existing
        } else {
          name = await this.uniqueName(ownerId, parentId, safeName)
        }
      }

      // 配额：覆盖是「替换」不是「新增」，增量要减掉旧文件大小，否则 100MB 覆盖 100MB 会被误判空间不足
      const used = await this.usedBytes(ownerId)
      const delta = size - (overwriting?.size ?? 0)
      if (delta > 0 && used + delta > fileQuotaBytes()) {
        throw new BadRequestException(`存储空间不足：已用 ${this.readableSize(used)}，配额 ${this.readableSize(fileQuotaBytes())}，请先清理回收站`)
      }

      const storageKey = await this.persistUpload(tempPath, file.buffer, hash, ext)

      if (overwriting) {
        const previousKey = overwriting.storageKey
        overwriting.size = size
        overwriting.hash = hash
        overwriting.ext = ext
        overwriting.mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
        overwriting.storageKey = storageKey
        overwriting.updateTime = new Date()
        const saved = await this.fileRepository.save(overwriting)
        // 旧内容的物理文件此刻可能已无人引用：不清就是「每覆盖一次漏一份磁盘」
        if (previousKey && previousKey !== storageKey) {
          await this.removeStorageIfUnused(previousKey)
        }
        return { skipped: false, file: saved, message: `已覆盖「${safeName}」` }
      }

      const saved = await this.fileRepository.save(
        this.fileRepository.create({
          parentId,
          name,
          isFolder: 0,
          ext,
          mime: MIME_BY_EXT[ext] ?? 'application/octet-stream',
          size,
          storageKey,
          hash,
          ownerId,
          deptId: 0,
          isStarred: 0,
          isDeleted: 0,
          sortOrder: 0,
          remark: '',
          createTime: new Date(),
          updateTime: new Date()
        })
      )
      // 前置校验与 INSERT 之间没有锁，并发上传可能双双通过；落地后再核一次，超额就撤销本次写入
      await this.assertQuotaAfterWrite(ownerId, saved)
      return { skipped: false, file: saved, message: name === safeName ? `已上传「${name}」` : `同名文件已存在，已保存为「${name}」` }
    } finally {
      // 临时文件兜底清理（正常路径已被 rename 掉，unlink 会失败，忽略即可）
      if (tempPath) await fs.promises.unlink(tempPath).catch(() => undefined)
    }
  }

  /** 单条详情（控制器用；归属校验在 findOneOrFail 里） */
  async detail(ownerId: string, id: number): Promise<FileEntity> {
    return this.findOneOrFail(ownerId, id)
  }

  /** 下载信息（控制器负责设响应头并流式回传） */
  async getDownloadInfo(ownerId: string, id: number): Promise<{ absolutePath: string; name: string; mime: string; size: number }> {
    const item = await this.findOneOrFail(ownerId, id)
    if (item.isFolder) {
      throw new BadRequestException('文件夹暂不支持直接下载，请进入文件夹后选择具体文件')
    }
    if (!item.storageKey) {
      throw new NotFoundException('该文件没有物理存储记录')
    }
    const absolutePath = this.absolutePath(item.storageKey)
    if (!fs.existsSync(absolutePath)) {
      throw new NotFoundException('文件已丢失（可能被手动清理过存储目录）')
    }
    return { absolutePath, name: item.name, mime: item.mime || 'application/octet-stream', size: item.size }
  }

  /**
   * 在线预览信息：只放行位图 / PDF / 纯文本，其余让前端回退到下载。
   *
   * 安全要点：类型判定不能只看扩展名和库里的 mime（都是上传时可伪造的），
   * 必须读文件头验真 —— 否则「.png 里装 HTML」就能 inline 渲染成同源页面。
   */
  async getPreviewInfo(ownerId: string, id: number): Promise<{ absolutePath: string; name: string; mime: string; size: number }> {
    const item = await this.findOneOrFail(ownerId, id)
    if (item.isFolder) {
      throw new BadRequestException('文件夹不支持预览，请进入后选择文件')
    }
    if (!item.storageKey) {
      throw new NotFoundException('该文件没有物理存储记录')
    }
    const absolutePath = this.absolutePath(item.storageKey)
    if (!fs.existsSync(absolutePath)) {
      throw new NotFoundException('文件已丢失（可能被手动清理过存储目录）')
    }

    const ext = this.normalizeExt(item.ext || getExtname(item.name))
    const head = await this.readHead(absolutePath)

    if (PREVIEW_IMAGE_EXTENSIONS.includes(ext)) {
      const signature = detectImageSignature(head)
      if (!signature) {
        throw new BadRequestException('文件内容与扩展名不符，无法预览，请下载查看')
      }
      return { absolutePath, name: item.name, mime: signature.mime, size: item.size }
    }
    if (ext === 'pdf') {
      if (head.subarray(0, 4).toString('ascii') !== '%PDF') {
        throw new BadRequestException('文件内容与扩展名不符，无法预览，请下载查看')
      }
      return { absolutePath, name: item.name, mime: 'application/pdf', size: item.size }
    }
    if (PREVIEW_TEXT_EXTENSIONS.includes(ext)) {
      // 统一按 text/plain 返回：即使内容真是 HTML，浏览器也不会解析执行
      return { absolutePath, name: item.name, mime: 'text/plain; charset=utf-8', size: item.size }
    }
    throw new BadRequestException('该类型暂不支持在线预览，请下载查看')
  }

  /** 改名 / 移动 / 星标；移动时防环（目标不能是自己或自己的子孙目录） */
  async update(ownerId: string, id: number, dto: UpdateFileDto): Promise<FileEntity> {
    const item = await this.findOneOrFail(ownerId, id)
    const patch: Partial<FileEntity> = { updateTime: new Date() }

    if (dto.name !== undefined) {
      const name = this.truncateName(dto.name.trim())
      if (name !== item.name) {
        await this.assertNameFree(ownerId, item.parentId, name, item.id)
        patch.name = name
        if (item.isFolder === 0) {
          const ext = this.normalizeExt(getExtname(name))
          patch.ext = ext
          patch.mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
        }
      }
    }

    if (dto.parentId !== undefined && dto.parentId !== item.parentId) {
      await this.assertFolderExists(ownerId, dto.parentId)
      if (item.isFolder === 1) {
        if (dto.parentId === item.id) {
          throw new BadRequestException('不能把文件夹移动到它自己下面')
        }
        if (await this.isDescendant(ownerId, dto.parentId, item.id)) {
          throw new BadRequestException('不能把文件夹移动到它自己的子目录里')
        }
      }
      await this.assertNameFree(ownerId, dto.parentId, patch.name ?? item.name, item.id)
      patch.parentId = dto.parentId
    }

    if (dto.starred !== undefined) {
      patch.isStarred = dto.starred ? 1 : 0
    }

    if (Object.keys(patch).length === 1) {
      return item
    }
    await this.fileRepository.update(item.id, patch)
    return this.findOneOrFail(ownerId, id)
  }

  /** 软删（进回收站）：文件夹连同所有子孙一起标记，物理文件不动 */
  async softDelete(ownerId: string, ids: number[]): Promise<{ deleted: number }> {
    const allIds = await this.collectSubtreeIds(ownerId, ids)
    if (!allIds.length) return { deleted: 0 }
    const result = await this.fileRepository.update({ id: In(allIds), ownerId, isDeleted: 0 }, { isDeleted: 1, deletedAt: new Date(), updateTime: new Date() })
    return { deleted: result.affected ?? 0 }
  }

  /** 回收站列表（按删除时间倒序） */
  async recycled(ownerId: string, page = 1, pageSize = 20): Promise<Pagination<FileEntity>> {
    const qb = this.fileRepository
      .createQueryBuilder('f')
      .where('f.owner_id = :ownerId', { ownerId })
      .andWhere('f.is_deleted = 1')
      .orderBy('f.deleted_at', 'DESC')
    applyTenantScope(qb, 'f')
    return paginate(qb, { page, pageSize })
  }

  /**
   * 从回收站恢复；父目录也已被删时一并恢复父链，避免恢复出一个孤儿。
   *
   * 恢复前要查一次重名：文件在回收站期间，同目录可能又新建了同名文件，
   * 直接 `is_deleted = 0` 会出现两条同名记录，之后重命名/移动的查重也会一直报冲突。
   * 冲突的按 `报告(1).pdf` 自动改名，并在返回值里报告数量。
   */
  async restore(ownerId: string, ids: number[]): Promise<{ restored: number; renamed: number }> {
    const items = await this.fileRepository.find({ where: { id: In(ids), ownerId, isDeleted: 1 } })
    if (!items.length) return { restored: 0, renamed: 0 }

    const restoreIds = new Set<number>()
    for (const item of items) {
      let currentId = item.parentId
      for (let depth = 0; depth < FILE_MAX_DEPTH && currentId !== FILE_ROOT_ID; depth++) {
        const parent = await this.fileRepository.findOne({ where: { id: currentId, ownerId } })
        if (!parent) break
        if (parent.isDeleted === 1) restoreIds.add(parent.id)
        currentId = parent.parentId
      }
    }
    for (const item of items) restoreIds.add(item.id)

    let renamed = 0
    const targets = await this.fileRepository.find({ where: { id: In([...restoreIds]), ownerId } })
    for (const target of targets) {
      const conflict = await this.fileRepository.findOne({ where: { ownerId, parentId: target.parentId, name: target.name, isDeleted: 0 } })
      if (!conflict) continue
      const next = await this.uniqueName(ownerId, target.parentId, target.name)
      await this.fileRepository.update(target.id, { name: next })
      renamed++
    }

    const result = await this.fileRepository.update({ id: In([...restoreIds]), ownerId }, { isDeleted: 0, deletedAt: null, updateTime: new Date() })
    return { restored: result.affected ?? 0, renamed }
  }

  /** 彻底删除：先删记录，再按 hash 判断物理文件是否还有别的引用，没有才删磁盘 */
  async purge(ownerId: string, ids: number[]): Promise<{ purged: number }> {
    const allIds = await this.collectSubtreeIds(ownerId, ids, true)
    const items = allIds.length ? await this.fileRepository.find({ where: { id: In(allIds), ownerId } }) : []
    if (!items.length) return { purged: 0 }

    await this.fileRepository.delete({ id: In(items.map(item => item.id)), ownerId })

    const storageKeys = [...new Set(items.map(item => item.storageKey).filter(Boolean))]
    for (const key of storageKeys) {
      // 还有别的记录引用同一份物理内容时不能删（同一 sha256 可能被多个用户/多处引用）
      await this.removeStorageIfUnused(key)
    }
    return { purged: items.length }
  }

  /**
   * 清空超期回收站（定时任务调用，无需登录态）
   *
   * 为什么必须有：配额只统计 `is_deleted = 0`，回收站不占账面空间，
   * 但物理文件还在磁盘上 —— 没有保留期的话磁盘只增不减，配额形同虚设。
   * 保留天数由 FILE_RECYCLE_DAYS 控制，<=0 关闭自动清理。
   */
  async sweepRecycled(): Promise<{ purged: number; owners: number }> {
    const days = recycleRetentionDays()
    if (days <= 0) return { purged: 0, owners: 0 }

    const deadline = new Date(Date.now() - days * 86_400_000)
    // 单轮上限，避免积压过多时一次跑爆内存/长时间占连接；其余下一轮继续
    const rows = await this.fileRepository.find({
      where: { isDeleted: 1, deletedAt: LessThan(deadline) },
      select: { id: true, ownerId: true },
      take: 1000
    })
    if (!rows.length) return { purged: 0, owners: 0 }

    const byOwner = new Map<string, number[]>()
    for (const row of rows) {
      const list = byOwner.get(row.ownerId)
      if (list) list.push(row.id)
      else byOwner.set(row.ownerId, [row.id])
    }

    let purged = 0
    for (const [ownerId, ids] of byOwner) {
      const result = await this.purge(ownerId, ids)
      purged += result.purged
    }
    return { purged, owners: byOwner.size }
  }

  /**
   * 清掉上传中断留下的临时文件（定时任务调用）
   *
   * multer 正常路径的临时文件会被 upload() 的 finally 删掉，
   * 但客户端中途断开、进程被强杀时没人收尸，长期会堆满 storage/tmp。
   */
  async sweepTempFiles(): Promise<{ removed: number }> {
    const hours = tempRetentionHours()
    if (hours <= 0) return { removed: 0 }

    const dir = fileTempDir()
    const names = await fs.promises.readdir(dir).catch(() => [] as string[])
    const deadline = Date.now() - hours * 3_600_000
    let removed = 0
    for (const name of names) {
      const full = path.join(dir, name)
      const stat = await fs.promises.stat(full).catch(() => null)
      if (!stat || !stat.isFile() || stat.mtimeMs > deadline) continue
      await fs.promises.unlink(full).catch(() => undefined)
      removed++
    }
    return { removed }
  }

  /** 存储用量：总量 + 文件数 + 文件夹数 + 按分类分布（存储卡数据源） */
  async stats(ownerId: string): Promise<FileStats> {
    const statsQb = this.fileRepository
      .createQueryBuilder('f')
      .select('f.is_folder', 'isFolder')
      .addSelect('f.ext', 'ext')
      .addSelect('COUNT(1)', 'count')
      .addSelect('COALESCE(SUM(f.size), 0)', 'bytes')
      .where('f.owner_id = :ownerId', { ownerId })
      .andWhere('f.is_deleted = 0')
      .groupBy('f.is_folder')
      .addGroupBy('f.ext')
    applyTenantScope(statsQb, 'f')
    const rows = (await statsQb.getRawMany()) as Array<{ isFolder: number | string; ext: string; count: string | number; bytes: string | number }>

    const buckets = new Map<FileKind, { bytes: number; count: number }>()
    for (const kind of Object.keys(KIND_LABELS) as Array<Exclude<FileKind, 'all'>>) {
      buckets.set(kind, { bytes: 0, count: 0 })
    }

    let fileCount = 0
    let folderCount = 0
    let totalBytes = 0
    for (const row of rows) {
      const count = Number(row.count) || 0
      const bytes = Number(row.bytes) || 0
      if (Number(row.isFolder) === 1) {
        folderCount += count
        continue
      }
      fileCount += count
      totalBytes += bytes
      buckets.get(this.kindOfExt(row.ext))!.bytes += bytes
      buckets.get(this.kindOfExt(row.ext))!.count += count
    }

    return {
      totalBytes,
      fileCount,
      folderCount,
      quotaBytes: fileQuotaBytes(),
      byKind: [...buckets.entries()].map(([kind, value]) => ({ kind, label: KIND_LABELS[kind as Exclude<FileKind, 'all'>], ...value }))
    }
  }

  /** 最近修改的文件（左栏「最近文件」） */
  async recent(ownerId: string, limit = 6): Promise<FileEntity[]> {
    return this.fileRepository.find({
      where: { ownerId, isDeleted: 0, isFolder: 0 },
      order: { updateTime: 'DESC', id: 'DESC' },
      take: Math.min(Math.max(limit, 1), 50)
    })
  }

  // ---------------------------------------------------------------------------
  // 内部工具
  // ---------------------------------------------------------------------------

  /** 按 id 取（必须属于当前用户且未删除），否则 404 */
  private async findOneOrFail(ownerId: string, id: number): Promise<FileEntity> {
    const item = await this.fileRepository.findOne({ where: { id, ownerId, isDeleted: 0 } })
    if (!item) {
      throw new NotFoundException('文件不存在或已删除')
    }
    return item
  }

  /** 父目录必须存在、属于当前用户、且是文件夹；0 表示根目录直接放行 */
  private async assertFolderExists(ownerId: string, parentId: number): Promise<void> {
    if (parentId === FILE_ROOT_ID) return
    const parent = await this.fileRepository.findOne({ where: { id: parentId, ownerId, isDeleted: 0 } })
    if (!parent) {
      throw new BadRequestException('目标目录不存在或已删除')
    }
    if (parent.isFolder !== 1) {
      throw new BadRequestException('目标位置不是文件夹')
    }
  }

  /** 同目录重名校验（软删的记录不参与，回收站里的同名不算冲突） */
  private async assertNameFree(ownerId: string, parentId: number, name: string, excludeId?: number): Promise<void> {
    const qb = this.fileRepository
      .createQueryBuilder('f')
      .where('f.owner_id = :ownerId', { ownerId })
      .andWhere('f.parent_id = :parentId', { parentId })
      .andWhere('f.name = :name', { name })
      .andWhere('f.is_deleted = 0')
    if (excludeId) {
      qb.andWhere('f.id <> :excludeId', { excludeId })
    }
    applyTenantScope(qb, 'f')
    if (await qb.getExists()) {
      throw new BadRequestException(`当前目录下已存在「${name}」`)
    }
  }

  /** 同名自动改名：报告.pdf → 报告(1).pdf → 报告(2).pdf */
  private async uniqueName(ownerId: string, parentId: number, name: string): Promise<string> {
    const ext = getExtname(name)
    const base = ext ? name.slice(0, -(ext.length + 1)) : name
    for (let index = 1; index < 1000; index++) {
      const candidate = ext ? `${base}(${index}).${ext}` : `${base}(${index})`
      const exists = await this.fileRepository.findOne({ where: { ownerId, parentId, name: candidate, isDeleted: 0 } })
      if (!exists) return this.truncateName(candidate)
    }
    throw new BadRequestException('同名文件过多，请先整理目录')
  }

  /** targetId 是否在 folderId 的子树里（用于移动防环） */
  private async isDescendant(ownerId: string, targetId: number, folderId: number): Promise<boolean> {
    let currentId = targetId
    for (let depth = 0; depth < FILE_MAX_DEPTH && currentId !== FILE_ROOT_ID; depth++) {
      if (currentId === folderId) return true
      const node = await this.fileRepository.findOne({ where: { id: currentId, ownerId } })
      if (!node) return false
      currentId = node.parentId
    }
    return false
  }

  /** 收集自身 + 全部子孙 id（BFS，逐层查库；includeDeleted=true 用于彻底删除） */
  private async collectSubtreeIds(ownerId: string, ids: number[], includeDeleted = false): Promise<number[]> {
    const collected = new Set<number>()
    let frontier = [...new Set(ids.filter(id => Number.isFinite(id) && id > 0))]
    const aliveFilter = includeDeleted ? {} : { isDeleted: 0 as const }

    for (let depth = 0; depth < FILE_MAX_DEPTH && frontier.length; depth++) {
      const rows = await this.fileRepository.find({ where: { id: In(frontier), ownerId, ...aliveFilter } })
      const folders: number[] = []
      for (const row of rows) {
        if (collected.has(row.id)) continue
        collected.add(row.id)
        if (row.isFolder === 1) folders.push(row.id)
      }
      if (!folders.length) break
      const children = await this.fileRepository.find({ where: { parentId: In(folders), ownerId, ...aliveFilter } })
      frontier = children.map(child => child.id).filter(id => !collected.has(id))
    }
    return [...collected]
  }

  /** 已用字节数（只算文件，不含文件夹） */
  private async usedBytes(ownerId: string): Promise<number> {
    const bytesQb = this.fileRepository
      .createQueryBuilder('f')
      .select('COALESCE(SUM(f.size), 0)', 'bytes')
      .where('f.owner_id = :ownerId', { ownerId })
      .andWhere('f.is_deleted = 0')
      .andWhere('f.is_folder = 0')
    applyTenantScope(bytesQb, 'f')
    const row = (await bytesQb.getRawOne()) as { bytes?: string | number } | undefined
    return Number(row?.bytes ?? 0)
  }

  /**
   * 落盘到内容寻址路径：storage/files/yyyy/MM/{sha256}.{ext}
   * 同 hash 的文件已存在时直接复用（不再写一次盘），这就是「一份内容只存一次」。
   * 优先 rename：临时文件和存储目录在同一块盘上，rename 是原子的也最省 IO。
   */
  private async persistUpload(tempPath: string | undefined, buffer: Buffer | undefined, hash: string, ext: string): Promise<string> {
    const now = new Date()
    const dir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`
    const relativeKey = `${dir}/${hash}${ext ? `.${ext}` : '.bin'}`
    const absolute = this.absolutePath(relativeKey)

    if (fs.existsSync(absolute)) return relativeKey
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true })

    if (tempPath) {
      try {
        await fs.promises.rename(tempPath, absolute)
      } catch {
        // 跨盘时 rename 会抛 EXDEV，退化成拷贝
        await fs.promises.copyFile(tempPath, absolute)
      }
      return relativeKey
    }
    await fs.promises.writeFile(absolute, buffer ?? Buffer.alloc(0))
    return relativeKey
  }

  /** 流式计算 sha256（大文件不读进内存） */
  private hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256')
      const stream = fs.createReadStream(filePath)
      stream.on('data', chunk => hash.update(chunk))
      stream.on('error', reject)
      stream.on('end', () => resolve(hash.digest('hex')))
    })
  }

  /** storage_key → 绝对路径；二次校验必须仍在存储根目录内（防脏数据穿越） */
  private absolutePath(storageKey: string): string {
    const root = path.resolve(storageRoot())
    const target = path.resolve(root, storageKey)
    if (!target.startsWith(root + path.sep)) {
      throw new BadRequestException('非法的存储路径')
    }
    return target
  }

  /** 读文件头 16 字节（验真实类型用，不要把整个文件读进内存） */
  private async readHead(filePath: string): Promise<Buffer> {
    const handle = await fs.promises.open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(16)
      const { bytesRead } = await handle.read(buffer, 0, 16, 0)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  /**
   * 物理文件没有任何记录引用时才清盘。
   *
   * 两处必须走这里：彻底删除（purge）与覆盖上传（overwrite）。
   * 覆盖上传尤其容易漏 —— 旧 `storage_key` 被替换后，那份文件就成了无主孤儿，
   * 页面照常能用，只有 `du -sh storage` 会慢慢涨。
   */
  private async removeStorageIfUnused(storageKey: string | null | undefined): Promise<void> {
    const key = storageKey?.trim()
    if (!key) return
    const stillUsed = await this.fileRepository.count({ where: { storageKey: key } })
    if (stillUsed > 0) return
    await fs.promises.unlink(this.absolutePath(key)).catch(() => undefined)
  }

  /**
   * 写库后二次核配额：超额就撤销本次写入并清盘。
   *
   * 前置的「查 SUM → 判断 → INSERT」没有事务锁，并发上传时两个请求可能都读到旧值、
   * 双双通过检查。这里在落地后复核一次，让账面永远不超过配额。
   * 代价：并发打满时后完成的那次会被撤销并提示重试 —— 比长期超配额、磁盘被撑爆好。
   */
  private async assertQuotaAfterWrite(ownerId: string, saved: FileEntity): Promise<void> {
    const quota = fileQuotaBytes()
    const after = await this.usedBytes(ownerId)
    if (after <= quota) return
    await this.fileRepository.delete({ id: saved.id, ownerId })
    await this.removeStorageIfUnused(saved.storageKey)
    throw new BadRequestException(`存储空间不足：本次上传后已达 ${this.readableSize(after)}，超过配额 ${this.readableSize(quota)}，请先清理回收站`)
  }

  /** multer 的 originalname 按 latin1 解出来，中文会变乱码，这里转回 utf8 */
  private decodeOriginalName(raw: string): string {
    if (!raw) return 'file'
    // 已经含非 latin1 字符说明是正确解码的 UTF-8，直接返回；否则按 latin1 → utf8 还原
    for (let index = 0; index < raw.length; index++) {
      if (raw.charCodeAt(index) > 0xff) return raw
    }
    try {
      return Buffer.from(raw, 'latin1').toString('utf8')
    } catch {
      return raw
    }
  }

  private truncateName(name: string): string {
    if (name.length <= 200) return name
    const ext = getExtname(name)
    const base = ext ? name.slice(0, -(ext.length + 1)) : name
    return `${base.slice(0, 200 - ext.length - 1)}${ext ? `.${ext}` : ''}`
  }

  private normalizeExt(ext: string): string {
    return (ext || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 10)
  }

  private kindOfExt(ext: string): Exclude<FileKind, 'all'> {
    const normalized = this.normalizeExt(ext)
    for (const [kind, exts] of Object.entries(KIND_EXTENSIONS) as Array<[Exclude<FileKind, 'all' | 'other'>, string[]]>) {
      if (exts.includes(normalized)) return kind
    }
    return 'other'
  }

  private readableSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  }
}
