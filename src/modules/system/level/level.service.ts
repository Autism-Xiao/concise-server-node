import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Brackets, In, Repository } from 'typeorm'

import { BaseService } from '../../../helper/crud/base.service'
import { applyTenantScope } from '../../../shared/tenant/tenant-scope.util'
import { normalizeBatchIds, runBatchDelete, type BatchDeleteResult } from '../../../helper/crud/batch-delete'
import {
  assertImportRows,
  createImportResult,
  failImportRow,
  parsePositiveInt,
  parseSwitchText,
  pickCell,
  resolveImportLayout,
  type ImportResult
} from '../../../helper/import/excel-import'
import { LevelEntity } from './entities/level.entity'
import type { CreateLevelDto } from './dto/create-level.dto'
import type { QueryLevelDto } from './dto/query-level.dto'
import type { UpdateLevelDto } from './dto/update-level.dto'

/** 导出上限：职级是基础数据，正常几十条，这里兜住异常膨胀 */
export const LEVEL_EXPORT_MAX_ROWS = 5000

/** 导入列别名：兼容用户手改表头 */
type LevelImportField = 'levelName' | 'levelRank' | 'status' | 'remark'

const LEVEL_IMPORT_ALIASES: Record<LevelImportField, string[]> = {
  levelName: ['职级名称', '名称', '职级', 'levelname'],
  levelRank: ['等级数值', '等级', '排序', 'levelrank'],
  status: ['状态', 'status'],
  remark: ['备注', '说明', 'remark']
}

@Injectable()
export class LevelService extends BaseService<LevelEntity> {
  constructor(
    @InjectRepository(LevelEntity)
    private readonly levelRepository: Repository<LevelEntity>
  ) {
    super(levelRepository, '职级')
  }

  /** 职级列表（level_rank 降序=级别从高到低），keyword 模糊匹配名称/备注 */
  async listByQuery(query: QueryLevelDto): Promise<LevelEntity[]> {
    const qb = this.levelRepository.createQueryBuilder('level').orderBy('level.level_rank', 'DESC')
    applyTenantScope(qb, 'level')
    const keyword = query.keyword?.trim()
    if (keyword) {
      // andWhere 而不是 where：避免把上面的租户条件覆盖掉
      qb.andWhere(new Brackets(sub => sub.where('level.level_name LIKE :kw', { kw: `%${keyword}%` }).orWhere('level.remark LIKE :kw', { kw: `%${keyword}%` })))
    }
    return qb.getMany()
  }

  /** 创建职级：level_name 唯一（数据库唯一索引兜底，前置拦截给可读报错） */
  async createLevel(dto: CreateLevelDto, operator?: string): Promise<LevelEntity> {
    await this.assertNameAvailable(dto.levelName)
    return this.create({
      ...dto,
      createBy: operator,
      createTime: new Date()
    })
  }

  /** 更新职级：改名时校验唯一 */
  async updateLevel(id: string, dto: UpdateLevelDto, operator?: string): Promise<LevelEntity> {
    const before = await this.findOne(id)
    if (dto.levelName && dto.levelName !== before.levelName) {
      await this.assertNameAvailable(dto.levelName)
    }
    return this.update(id, { ...dto, updateBy: operator, updateTime: new Date() })
  }

  private async assertNameAvailable(levelName: string): Promise<void> {
    const exists = await this.levelRepository.findOne({ where: { levelName } })
    if (exists) {
      throw new BadRequestException(`职级「${levelName}」已存在`)
    }
  }

  /** 导出：与列表同筛选条件，超出上限截断（前端副标题会显示实际条数） */
  async exportLevels(query: QueryLevelDto): Promise<LevelEntity[]> {
    const list = await this.listByQuery(query)
    return list.slice(0, LEVEL_EXPORT_MAX_ROWS)
  }

  /**
   * 导入职级（xlsx 解析后的二维数组，第一行为表头）
   * - 按「职级名称」判定：不存在新增，已存在更新（只更新填了值的列）
   * - 单行失败不影响其他行，逐行返回失败原因
   */
  async importLevels(rows: string[][], headerRowNumber = 1, operator?: string): Promise<ImportResult> {
    if (!rows.length) {
      throw new BadRequestException('文件内容为空，请下载模板后填写')
    }
    const { columns, dataRows } = resolveImportLayout<LevelImportField>(rows, headerRowNumber, LEVEL_IMPORT_ALIASES)
    if (columns.levelName === undefined) {
      throw new BadRequestException('未找到「职级名称」列，请使用导入模板的表头')
    }
    assertImportRows(dataRows)

    const existing = await this.levelRepository.find()
    const byName = new Map(existing.map(level => [level.levelName.trim().toLowerCase(), level]))
    const seen = new Set<string>()
    const result = createImportResult(dataRows.length)

    for (const { rowNumber, cells } of dataRows) {
      const levelName = pickCell(columns, cells, 'levelName')
      const rankText = pickCell(columns, cells, 'levelRank')
      const statusText = pickCell(columns, cells, 'status')

      if (!levelName) {
        failImportRow(result, rowNumber, '职级名称不能为空')
        continue
      }
      if (levelName.length > 100) {
        failImportRow(result, rowNumber, '职级名称最长 100 个字符', levelName)
        continue
      }
      const nameKey = levelName.toLowerCase()
      if (seen.has(nameKey)) {
        result.skipped += 1
        result.errors.push({ row: rowNumber, key: levelName, message: '文件内职级名称重复，本行已跳过' })
        continue
      }
      seen.add(nameKey)

      const levelRank = parsePositiveInt(rankText, 0)
      if (levelRank === undefined) {
        failImportRow(result, rowNumber, '等级数值必须是 0 或正整数', levelName)
        continue
      }
      const status = parseSwitchText(statusText)
      if (statusText && status === undefined) {
        failImportRow(result, rowNumber, '状态请填「正常」或「停用」', levelName)
        continue
      }
      const remark = pickCell(columns, cells, 'remark') || undefined

      const current = byName.get(nameKey)
      if (current) {
        await this.levelRepository.update(current.id, {
          levelRank,
          ...(status ? { status } : {}),
          ...(remark !== undefined ? { remark } : {}),
          updateBy: operator,
          updateTime: new Date()
        })
        result.updated += 1
        continue
      }

      const created = await this.create({
        levelName,
        levelRank,
        status: status ?? '1',
        remark,
        createBy: operator,
        createTime: new Date()
      })
      byName.set(nameKey, created)
      result.created += 1
    }

    return result
  }

  /** 批量删除：逐条硬删，单条失败返回原因（职级暂无关联数据，失败通常是 id 已不存在） */
  async batchDelete(ids: string[]): Promise<BatchDeleteResult> {
    const targets = await this.levelRepository.findBy({ id: In(normalizeBatchIds(ids)) })
    return runBatchDelete(
      targets,
      {
        getId: level => level.id,
        getName: level => level.levelName,
        remove: level => this.delete(level.id)
      },
      ids
    )
  }
}
