import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, type DeepPartial } from 'typeorm'

import { BaseService } from '../../../helper/crud/base.service'
import { toPagination, type Pagination } from '../../../helper/paginate'
import { isDuplicateEntryError } from '../../../utils/db-error.util'
import { RegionEntity } from './entities/region.entity'
import { REGION_LEVEL_TEXTS } from './dto/create-region.dto'
import type { CreateRegionDto } from './dto/create-region.dto'
import type { ImportRegionDto } from './dto/import-region.dto'

export interface RegionTreeItem extends RegionEntity {
  children: RegionTreeItem[]
}

/** 区划统计：total 总数，byLevel 各层级数量（无数据的层级为 0） */
export interface RegionStats {
  total: number
  byLevel: Record<number, number>
}

@Injectable()
export class RegionService extends BaseService<RegionEntity> {
  constructor(
    @InjectRepository(RegionEntity)
    repository: Repository<RegionEntity>
  ) {
    super(repository, '行政区划')
  }

  /** 分页列表：keyword 模糊匹配 名称/简称/拼音/区划代码，level / parentCode 精确过滤 */
  async listByQuery(query: { keyword?: string; level?: number; parentCode?: string }): Promise<Pagination<RegionEntity>> {
    const qb = this.repository.createQueryBuilder('region').orderBy('region.areaCode', 'ASC')
    const keyword = query.keyword?.trim()
    if (keyword) {
      qb.andWhere('(region.name LIKE :kw OR region.shortName LIKE :kw OR region.pinyin LIKE :kw OR region.areaCode LIKE :kw)', { kw: `%${keyword}%` })
    }
    if (query.level !== undefined && query.level !== null && Number.isFinite(query.level)) {
      qb.andWhere('region.level = :level', { level: query.level })
    }
    if (query.parentCode !== undefined && query.parentCode !== null && query.parentCode !== '') {
      qb.andWhere('region.parentCode = :parentCode', { parentCode: query.parentCode })
    }
    const all = await qb.getMany()
    return toPagination(all)
  }

  /** 全量扁平列表（树组装 / 级联选择器数据源用） */
  async listAll(): Promise<RegionEntity[]> {
    return this.repository.find({ order: { areaCode: 'ASC' } })
  }

  /** 全量树（顶级为 parentCode='0'；全量内存组装，不递归查库） */
  async getTree(): Promise<RegionTreeItem[]> {
    const all = await this.listAll()
    return buildRegionTree(all, '0')
  }

  /** 按上级区划代码查直接子级（级联选择器懒加载用） */
  async listChildren(parentCode: string): Promise<RegionEntity[]> {
    return this.repository.find({ where: { parentCode }, order: { areaCode: 'ASC' } })
  }

  /**
   * 区划总量统计（按层级分组）
   *
   * 为什么单独做接口：区划管理页改成树形懒加载后，前端手里只有当前展开的节点，
   * 拿不到「共多少条」。用一条 group by 查出来，避免为了个数字拉全量 4 万多行。
   */
  async stats(): Promise<RegionStats> {
    const rows = await this.repository
      .createQueryBuilder('region')
      .select('region.level', 'level')
      .addSelect('COUNT(1)', 'count')
      .groupBy('region.level')
      .getRawMany<{ level: number | string; count: string | number }>()
    const byLevel: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 }
    let total = 0
    for (const row of rows) {
      const level = Number(row.level)
      const count = Number(row.count)
      if (!Number.isFinite(level) || !Number.isFinite(count)) continue
      byLevel[level] = (byLevel[level] ?? 0) + count
      total += count
    }
    return { total, byLevel }
  }

  /** 按区划代码查单条 */
  async findByAreaCode(areaCode: string): Promise<RegionEntity> {
    const region = await this.repository.findOne({ where: { areaCode } })
    if (!region) {
      throw new NotFoundException(`区划代码 ${areaCode} 不存在`)
    }
    return region
  }

  /** 创建：父级必须存在、areaCode 查重 + 唯一索引兜底、levelText 由 level 推导 */
  async create(dto: CreateRegionDto): Promise<RegionEntity> {
    await this.assertParentExists(dto.parentCode)
    await this.assertAreaCodeFree(dto.areaCode)
    const entity = this.repository.create({
      ...dto,
      shortName: dto.shortName ?? '',
      fullName: dto.fullName ?? dto.name,
      pinyin: dto.pinyin ?? '',
      cityCode: dto.cityCode ?? '',
      zipCode: dto.zipCode ?? '',
      lng: dto.lng ?? '',
      lat: dto.lat ?? '',
      levelText: REGION_LEVEL_TEXTS[dto.level] ?? '',
      pid: 0,
      createTime: new Date()
    } as DeepPartial<RegionEntity>)
    try {
      return await this.repository.save(entity)
    } catch (error) {
      if (isDuplicateEntryError(error)) {
        throw new BadRequestException(`区划代码「${dto.areaCode}」已存在（并发写入），请刷新后重试`)
      }
      throw error
    }
  }

  /** 更新：areaCode 冲突校验；改 parentCode 时防环（不能是自己或自己的后代） */
  async update(id: number | string, dto: DeepPartial<RegionEntity> & Partial<CreateRegionDto>): Promise<RegionEntity> {
    const before = await this.findOne(id)
    if (dto.areaCode !== undefined && dto.areaCode !== before.areaCode) {
      await this.assertAreaCodeFree(dto.areaCode)
    }
    if (dto.parentCode !== undefined) {
      const parentCode = dto.parentCode
      if (parentCode === before.areaCode) {
        throw new BadRequestException('上级区划不能是自身')
      }
      if (parentCode !== '0') {
        await this.findByAreaCode(parentCode)
        const all = await this.listAll()
        const descendantCodes = this.collectDescendantCodes(all, before.areaCode)
        if (descendantCodes.has(parentCode)) {
          throw new BadRequestException('上级区划不能是自己的下级')
        }
      }
    }
    const patch = { ...dto, updateTime: new Date() } as DeepPartial<RegionEntity>
    if (dto.level !== undefined) {
      Object.assign(patch, { levelText: REGION_LEVEL_TEXTS[dto.level] ?? before.levelText })
    }
    try {
      return await super.update(id, patch)
    } catch (error) {
      if (isDuplicateEntryError(error)) {
        throw new BadRequestException(`区划代码「${String(dto.areaCode)}」已存在，请修改后重试`)
      }
      throw error
    }
  }

  /** 删除（物理删除）：存在下级区划时拒绝（区划是基础数据，不做软删/回收站） */
  async delete(id: number | string): Promise<void> {
    const region = await this.findOne(id)
    const childCount = await this.repository.count({ where: { parentCode: region.areaCode } })
    if (childCount > 0) {
      throw new BadRequestException(`该区划下存在 ${childCount} 个下级区划，无法删除`)
    }
    await this.repository.delete(id)
  }

  /**
   * 批量导入（对齐第三方区划库 JSON）：按 areaCode upsert
   *  - 已存在 → 更新名称等字段（以导入数据为准）
   *  - 不存在 → 插入；levelText 由 level 推导；parentCode 不存在时该条失败并计入 skipped
   *  - 整体走一个事务，分批 save，任何数据库错误回滚并抛 400
   */
  async importRegions(
    dto: ImportRegionDto
  ): Promise<{ inserted: number; updated: number; skipped: number; failed: Array<{ areaCode: string; reason: string }> }> {
    const items = dto.regions
    // 同一批内先按 areaCode 去重，后面的重复条目直接记 skipped
    const byCode = new Map<string, ImportRegionDto['regions'][number]>()
    const batchFailed: Array<{ areaCode: string; reason: string }> = []
    let skipped = 0
    for (const item of items) {
      if (!item.areaCode || !item.name || item.level === undefined || item.level === null) {
        batchFailed.push({ areaCode: item.areaCode ?? '(空)', reason: '缺少 areaCode / name / level' })
        continue
      }
      if (byCode.has(item.areaCode)) {
        skipped++
        continue
      }
      byCode.set(item.areaCode, item)
    }

    const manager = this.repository.manager
    return manager.transaction(async em => {
      const repo = em.getRepository(RegionEntity)
      const codes = [...byCode.keys()]
      const existing = codes.length ? await repo.find({ where: codes.map(areaCode => ({ areaCode })) }) : []
      const existingMap = new Map(existing.map(r => [r.areaCode, r]))
      const all = await repo.find()
      const codeSet = new Set(all.map(r => r.areaCode))

      let inserted = 0
      let updated = 0
      const failed = [...batchFailed]
      const rows: DeepPartial<RegionEntity>[] = []
      for (const [areaCode, rawItem] of byCode) {
        // 剥离第三方数据里的 id（本系统自增主键，不能被外部值覆盖）
        const { id: _ignored, levelText: _rawLevelText, ...item } = rawItem
        const levelText = item.level === undefined || item.level === null ? '' : (REGION_LEVEL_TEXTS[item.level] ?? '')
        const parentCode = item.parentCode ?? '0'
        // 父级校验：非顶级时父代码必须在库或在本批次中
        if (parentCode !== '0' && !codeSet.has(parentCode) && !byCode.has(parentCode)) {
          failed.push({ areaCode, reason: `上级区划 ${parentCode} 不存在` })
          continue
        }
        const prev = existingMap.get(areaCode)
        if (prev) {
          rows.push({ ...prev, ...item, levelText, updateTime: new Date() } as DeepPartial<RegionEntity>)
          updated++
        } else {
          rows.push({
            areaCode,
            parentCode,
            level: item.level,
            levelText,
            name: item.name,
            shortName: item.shortName ?? '',
            fullName: item.fullName ?? item.name,
            pinyin: item.pinyin ?? '',
            cityCode: item.cityCode ?? '',
            zipCode: item.zipCode ?? '',
            lng: item.lng ?? '',
            lat: item.lat ?? '',
            createTime: new Date()
          } as DeepPartial<RegionEntity>)
          inserted++
        }
      }

      // 分批写入，避免单条 SQL 过大
      const CHUNK = 500
      for (let i = 0; i < rows.length; i += CHUNK) {
        await repo.save(rows.slice(i, i + CHUNK))
      }

      return { inserted, updated, skipped, failed }
    })
  }

  /** 区划代码是否可用（创建/改码前查重） */
  private async assertAreaCodeFree(areaCode: string): Promise<void> {
    const exists = await this.repository.count({ where: { areaCode } })
    if (exists > 0) {
      throw new BadRequestException(`区划代码「${areaCode}」已存在`)
    }
  }

  /** 上级区划必须存在（'0' 表示顶级） */
  private async assertParentExists(parentCode: string): Promise<void> {
    if (parentCode === '0') {
      return
    }
    await this.findByAreaCode(parentCode)
  }

  /** 收集某区划所有后代的 areaCode（防环用） */
  private collectDescendantCodes(all: RegionEntity[], rootCode: string): Set<string> {
    const result = new Set<string>()
    const walk = (parentCode: string) => {
      for (const region of all) {
        if (region.parentCode === parentCode && !result.has(region.areaCode)) {
          result.add(region.areaCode)
          walk(region.areaCode)
        }
      }
    }
    walk(rootCode)
    return result
  }
}

/** list-to-tree：一次取全量后内存组装（与 dept 模块同思路，不递归查库） */
export function buildRegionTree(all: RegionEntity[], parentCode: string): RegionTreeItem[] {
  return all
    .filter(region => region.parentCode === parentCode)
    .map(region =>
      // 实体实例展开为 plain object 组树（响应走 JSON 序列化，无原型丢失问题）
      // oxlint-disable-next-line typescript(no-misused-spread)
      ({
        ...region,
        children: buildRegionTree(all, region.areaCode)
      })
    )
}
