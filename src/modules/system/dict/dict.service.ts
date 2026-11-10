import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'

import { BaseService } from '../../../helper/crud/base.service'
import { BizErrorCode } from '../../../common/enums/biz-error-code.enum'
import { BizException } from '../../../common/exceptions/biz.exception'
import { normalizeBatchIds, runBatchDelete, type BatchDeleteResult } from '../../../helper/crud/batch-delete'
import {
  assertImportLimit,
  createImportResult,
  failImportRow,
  parsePositiveInt,
  parseSwitchText,
  pickCell,
  resolveImportLayout,
  type ImportResult
} from '../../../helper/import/excel-import'
import { randomId32 } from '../../../utils/password.util'
import { applyTenantScope } from '../../../shared/tenant/tenant-scope.util'
import { SysDictEntity } from './entities/sys-dict.entity'
import { SysDictItemEntity } from './entities/sys-dict-item.entity'
import type { CreateDictDto } from './dto/create-dict.dto'
import type { QueryDictDto } from './dto/query-dict.dto'
import type { UpdateDictDto } from './dto/update-dict.dto'

/** 导出上限：字典是配置数据，正常几十条 */
export const DICT_EXPORT_MAX_ROWS = 5000

/** 导入列别名 —— 字典类型 */
type DictTypeImportField = 'dictCode' | 'dictName' | 'valueType' | 'description'

export const DICT_TYPE_IMPORT_ALIASES: Record<DictTypeImportField, string[]> = {
  dictCode: ['字典编码', '编码', 'dictcode'],
  dictName: ['字典名称', '名称', 'dictname'],
  valueType: ['值类型', '类型', 'valuetype', 'type'],
  description: ['描述', '说明', '备注', 'description']
}

/** 导入列别名 —— 字典项 */
type DictItemImportField = 'dictCode' | 'itemText' | 'itemValue' | 'sortOrder' | 'status' | 'description'

export const DICT_ITEM_IMPORT_ALIASES: Record<DictItemImportField, string[]> = {
  dictCode: ['字典编码', '所属字典', '编码', 'dictcode'],
  itemText: ['字典项文本', '项文本', '文本', 'itemtext'],
  itemValue: ['字典项值', '项值', '值', 'itemvalue'],
  sortOrder: ['排序', 'sortorder'],
  status: ['状态', 'status'],
  description: ['描述', '说明', '备注', 'description']
}

/** 值类型文本 → 0 string / 1 number */
function parseValueType(text: string): number | undefined {
  const value = text.trim().toLowerCase()
  if (!value) {
    return undefined
  }
  if (['0', 'string', '字符串', '文本'].includes(value)) {
    return 0
  }
  if (['1', 'number', '数字', '数值'].includes(value)) {
    return 1
  }
  return undefined
}

@Injectable()
export class DictService extends BaseService<SysDictEntity> {
  constructor(
    @InjectRepository(SysDictEntity)
    private readonly dictRepository: Repository<SysDictEntity>
  ) {
    super(dictRepository, '字典')
  }

  /** 字典列表：字典类型数量少，一次全量返回（不分页），并带上每个字典的字典项数量 */
  async listByQuery(query: QueryDictDto): Promise<SysDictEntity[]> {
    const qb = this.dictRepository.createQueryBuilder('dict').where('dict.del_flag = 0').orderBy('dict.create_time', 'DESC').addOrderBy('dict.id', 'DESC')
    applyTenantScope(qb, 'dict')

    const keyword = query.keyword?.trim()
    if (keyword) {
      qb.andWhere('(dict.dict_name LIKE :keyword OR dict.dict_code LIKE :keyword)', { keyword: `%${keyword}%` })
    }

    const list = await qb.getMany()
    if (!list.length) return list

    const counts = await this.dictRepository.manager
      .createQueryBuilder(SysDictItemEntity, 'item')
      .select('item.dict_id', 'dictId')
      .addSelect('COUNT(*)', 'count')
      .where('item.dict_id IN (:...ids)', { ids: list.map(dict => dict.id) })
      .groupBy('item.dict_id')
      .getRawMany<{ dictId: string; count: string }>()

    const countMap = new Map(counts.map(row => [row.dictId, Number(row.count)]))
    return list.map(dict => Object.assign(dict, { itemCount: countMap.get(dict.id) ?? 0 }))
  }

  /** 字典详情（排除已删除） */
  async findDetail(id: string): Promise<SysDictEntity> {
    return this.findActive(id)
  }

  /** 创建字典：编码全局唯一（软删的记录仍占唯一索引，所以不带 del_flag 条件） */
  async createDict(dto: CreateDictDto, operator?: string): Promise<SysDictEntity> {
    await this.assertCodeAvailable(dto.dictCode)
    return this.create({
      dictName: dto.dictName,
      dictCode: dto.dictCode,
      type: dto.type ?? 0,
      description: dto.description,
      delFlag: 0,
      createBy: operator,
      createTime: new Date()
    })
  }

  /** 更新字典：改编码时重新校验唯一性；用 QueryBuilder 以便把 description 清空为 null */
  async updateDict(id: string, dto: UpdateDictDto, operator?: string): Promise<SysDictEntity> {
    await this.findActive(id)
    if (dto.dictCode) {
      await this.assertCodeAvailable(dto.dictCode, id)
    }

    const patch: Record<string, unknown> = {}
    if (dto.dictName !== undefined) patch.dictName = dto.dictName
    if (dto.dictCode !== undefined) patch.dictCode = dto.dictCode
    if (dto.type !== undefined) patch.type = dto.type
    if (dto.description !== undefined) patch.description = dto.description || null
    patch.updateBy = operator ?? null
    patch.updateTime = new Date()

    await this.dictRepository.createQueryBuilder().update(SysDictEntity).set(patch).where('id = :id', { id }).execute()
    return this.findActive(id)
  }

  /** 删除字典：软删（JeecgBoot 的 del_flag=1）；字典下还有字典项时拒绝 */
  async deleteDict(id: string): Promise<void> {
    await this.findActive(id)
    const itemCount = await this.dictRepository.manager.count(SysDictItemEntity, { where: { dictId: id } })
    if (itemCount > 0) {
      throw new BizException(BizErrorCode.DICT_HAS_ITEMS, `该字典下存在 ${itemCount} 个字典项，请先删除字典项`, HttpStatus.BAD_REQUEST)
    }
    await this.dictRepository.createQueryBuilder().update(SysDictEntity).set({ delFlag: 1, updateTime: new Date() }).where('id = :id', { id }).execute()
  }

  /** 取未删除的字典，不存在抛 404 */
  private async findActive(id: string): Promise<SysDictEntity> {
    const dict = await this.dictRepository.findOne({ where: { id, delFlag: 0 } })
    if (!dict) {
      throw new NotFoundException('字典不存在')
    }
    return dict
  }

  /** 字典编码唯一校验 */
  private async assertCodeAvailable(dictCode: string, excludeId?: string): Promise<void> {
    const qb = this.dictRepository.createQueryBuilder('dict').where('dict.dict_code = :dictCode', { dictCode })
    if (excludeId) {
      qb.andWhere('dict.id <> :excludeId', { excludeId })
    }
    if (await qb.getExists()) {
      throw new BizException(BizErrorCode.DICT_CODE_CONFLICT, `字典编码「${dictCode}」已存在`, HttpStatus.BAD_REQUEST)
    }
  }

  /** 导出：字典类型 + 字典项一起带走（字典项靠 dictCode 关联，不用人工对齐两份文件） */
  async exportDicts(query: QueryDictDto): Promise<{ dicts: SysDictEntity[]; items: SysDictItemEntity[] }> {
    const dicts = (await this.listByQuery(query)).slice(0, DICT_EXPORT_MAX_ROWS)
    if (!dicts.length) {
      return { dicts, items: [] }
    }
    const items = await this.dictRepository.manager.find(SysDictItemEntity, {
      where: { dictId: In(dicts.map(dict => dict.id)) },
      order: { sortOrder: 'ASC', id: 'ASC' }
    })
    return { dicts, items }
  }

  /**
   * 导入字典（一个工作簿两张表：字典类型 + 字典项，靠 dictCode 关联）
   * - 字典类型按 dictCode 判定：不存在新增，已存在（含已软删的）恢复并更新
   * - 字典项按「dictCode + itemValue」判定：不存在新增，已存在更新
   * - 错误信息带 [字典类型]/[字典项] 前缀，用户能看出是哪张表出的问题
   */
  async importDicts(typeRows: string[][], typeHeaderRow: number, itemRows: string[][], itemHeaderRow: number, operator?: string): Promise<ImportResult> {
    if (!typeRows.length && !itemRows.length) {
      throw new BizException(BizErrorCode.IMPORT_EMPTY, '文件内容为空，请下载模板后填写', HttpStatus.BAD_REQUEST)
    }

    const result = createImportResult()
    const allDicts = await this.dictRepository.find()
    const byCode = new Map(allDicts.map(dict => [dict.dictCode.trim().toLowerCase(), dict]))
    const dictType = new Map<string, SysDictEntity>()
    for (const dict of allDicts) {
      if (dict.delFlag === 0) {
        dictType.set(dict.id, dict)
      }
    }

    // ---- 第一张表：字典类型 ----
    if (typeRows.length) {
      const { columns, dataRows } = resolveImportLayout<DictTypeImportField>(typeRows, typeHeaderRow, DICT_TYPE_IMPORT_ALIASES)
      if (columns.dictCode === undefined) {
        throw new BizException(BizErrorCode.IMPORT_HEADER_MISMATCH, '「字典类型」工作表未找到「字典编码」列，请使用导入模板', HttpStatus.BAD_REQUEST)
      }
      assertImportLimit(dataRows)
      result.total += dataRows.length
      const seen = new Set<string>()

      for (const { rowNumber, cells } of dataRows) {
        const dictCode = pickCell(columns, cells, 'dictCode')
        const dictName = pickCell(columns, cells, 'dictName')
        const typeText = pickCell(columns, cells, 'valueType')
        const description = pickCell(columns, cells, 'description') || undefined

        if (!dictCode) {
          failImportRow(result, rowNumber, '[字典类型] 字典编码不能为空')
          continue
        }
        if (dictCode.length > 100) {
          failImportRow(result, rowNumber, '[字典类型] 字典编码最长 100 个字符', dictCode)
          continue
        }
        const codeKey = dictCode.toLowerCase()
        if (seen.has(codeKey)) {
          result.skipped += 1
          result.errors.push({ row: rowNumber, key: dictCode, message: '[字典类型] 文件内字典编码重复，本行已跳过' })
          continue
        }
        seen.add(codeKey)

        const type = parseValueType(typeText)
        if (typeText && type === undefined) {
          failImportRow(result, rowNumber, '[字典类型] 值类型请填「string」或「number」', dictCode)
          continue
        }

        const current = byCode.get(codeKey)
        if (current) {
          await this.dictRepository.update(current.id, {
            ...(dictName ? { dictName } : {}),
            ...(type !== undefined ? { type } : {}),
            ...(description !== undefined ? { description } : {}),
            delFlag: 0,
            updateBy: operator,
            updateTime: new Date()
          })
          // 之前软删的字典恢复后要重新进入「可用字典」表，否则同文件里的字典项会找不到它
          current.delFlag = 0
          dictType.set(current.id, current)
          result.updated += 1
          continue
        }

        if (!dictName) {
          failImportRow(result, rowNumber, '[字典类型] 新增字典时字典名称不能为空', dictCode)
          continue
        }
        const created = await this.create({
          dictCode,
          dictName,
          type: type ?? 0,
          description,
          delFlag: 0,
          createBy: operator,
          createTime: new Date()
        })
        byCode.set(codeKey, created)
        dictType.set(created.id, created)
        result.created += 1
      }
    }

    // ---- 第二张表：字典项 ----
    if (itemRows.length) {
      const { columns, dataRows } = resolveImportLayout<DictItemImportField>(itemRows, itemHeaderRow, DICT_ITEM_IMPORT_ALIASES)
      if (columns.dictCode === undefined || columns.itemText === undefined || columns.itemValue === undefined) {
        throw new BizException(
          BizErrorCode.IMPORT_HEADER_MISMATCH,
          '「字典项」工作表缺少「字典编码 / 字典项文本 / 字典项值」列，请使用导入模板',
          HttpStatus.BAD_REQUEST
        )
      }
      assertImportLimit(dataRows)
      result.total += dataRows.length

      const dictIds = [...dictType.keys()]
      const existingItems = dictIds.length ? await this.dictRepository.manager.find(SysDictItemEntity, { where: { dictId: In(dictIds) } }) : []
      const itemKey = (dictId: string, value: string) => `${dictId}::${value.trim().toLowerCase()}`
      const itemByKey = new Map(existingItems.map(item => [itemKey(item.dictId, item.itemValue), item]))
      const seen = new Set<string>()

      for (const { rowNumber, cells } of dataRows) {
        const dictCode = pickCell(columns, cells, 'dictCode')
        const itemText = pickCell(columns, cells, 'itemText')
        const itemValue = pickCell(columns, cells, 'itemValue')
        const sortOrder = parsePositiveInt(pickCell(columns, cells, 'sortOrder'), 0)
        const statusText = pickCell(columns, cells, 'status')
        const status = parseSwitchText(statusText)
        const description = pickCell(columns, cells, 'description') || undefined

        if (!dictCode || !itemText || !itemValue) {
          failImportRow(result, rowNumber, '[字典项] 字典编码、字典项文本、字典项值均不能为空', dictCode || itemValue)
          continue
        }
        if (sortOrder === undefined) {
          failImportRow(result, rowNumber, '[字典项] 排序必须是 0 或正整数', itemValue)
          continue
        }
        if (statusText && status === undefined) {
          failImportRow(result, rowNumber, '[字典项] 状态请填「启用」或「停用」', itemValue)
          continue
        }
        const dict = byCode.get(dictCode.toLowerCase())
        if (!dict || dict.delFlag !== 0) {
          failImportRow(result, rowNumber, `[字典项] 字典「${dictCode}」不存在，请先在上方「字典类型」表里定义`, itemValue)
          continue
        }
        const key = itemKey(dict.id, itemValue)
        if (seen.has(key)) {
          result.skipped += 1
          result.errors.push({ row: rowNumber, key: itemValue, message: '[字典项] 同一字典下值重复，本行已跳过' })
          continue
        }
        seen.add(key)

        const current = itemByKey.get(key)
        if (current) {
          await this.dictRepository.manager.update(SysDictItemEntity, current.id, {
            itemText,
            sortOrder,
            ...(status ? { status: Number(status) } : {}),
            ...(description !== undefined ? { description } : {}),
            updateBy: operator,
            updateTime: new Date()
          })
          result.updated += 1
          continue
        }

        const created = await this.dictRepository.manager.save(SysDictItemEntity, {
          // 主键是 varchar 非自增，manager.save 不会自动生成，必须显式给 id
          id: randomId32(),
          dictId: dict.id,
          itemText,
          itemValue,
          sortOrder,
          status: status ? Number(status) : 1,
          description,
          createBy: operator,
          createTime: new Date()
        })
        itemByKey.set(key, created)
        result.created += 1
      }
    }

    if (!result.total) {
      throw new BizException(BizErrorCode.IMPORT_EMPTY, '文件里没有可导入的数据行，请在表头下方填写后再导入', HttpStatus.BAD_REQUEST)
    }
    return result
  }

  /** 批量删除字典：逐条走 deleteDict，保留「有字典项不可删」的保护并收集原因 */
  async batchDelete(ids: string[]): Promise<BatchDeleteResult> {
    const targets = await this.dictRepository.findBy({ id: In(normalizeBatchIds(ids)) })
    return runBatchDelete(
      targets,
      {
        getId: dict => dict.id,
        getName: dict => dict.dictName,
        remove: dict => this.deleteDict(dict.id)
      },
      ids
    )
  }
}
