import { BadRequestException, HttpStatus } from '@nestjs/common'

import { BizErrorCode } from '../../common/enums/biz-error-code.enum'
import { BizException } from '../../common/exceptions/biz.exception'

/**
 * Excel 导入公共件
 *
 * 各模块的导入流程是同一套：读表 → 定位表头 → 逐行校验 → 部分成功汇总。
 * 差异只在「列怎么映射」和「每行怎么校验」，所以这里只收敛公共部分：
 * - 统一的单文件限制（行数/体积），报错文案一致
 * - 表头定位（兼容手改列名、必填星号、全角空格）
 * - 行级错误收集（单行失败不影响其他行）
 */

/** 单次导入上限：2000 行 / 5MB，与用户、角色导入保持一致 */
export const IMPORT_MAX_ROWS = 2000
export const IMPORT_MAX_SIZE = 5 * 1024 * 1024

/** 单行失败明细：row 是 Excel 真实行号（不是数组下标），用户能直接定位 */
export interface ImportRowError {
  row: number
  /** 该行主键值（如编码/名称），便于用户认出是哪条 */
  key?: string
  message: string
}

/** 导入结果：各模块统一结构，前端可用同一个结果面板渲染 */
export interface ImportResult {
  total: number
  created: number
  updated: number
  skipped: number
  failed: number
  errors: ImportRowError[]
}

/** 新建空结果 */
export function createImportResult(total = 0): ImportResult {
  return { total, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] }
}

/** 记一条失败：同时累加计数，避免调用方漏写 failed */
export function failImportRow(result: ImportResult, row: number, message: string, key?: string): void {
  result.failed += 1
  result.errors.push({ row, key, message })
}

/** 表头归一化：去掉空格与必填星号（模板 richText 会显示「字典编码 *」），统一小写 */
export function normalizeHeader(text: string): string {
  return String(text ?? '')
    .replace(/[\s*＊]/g, '')
    .toLowerCase()
}

/** 一条待处理的数据行 */
export interface ImportDataRow {
  rowNumber: number
  cells: string[]
}

/** 列定位结果 */
export interface ImportLayout<T extends string> {
  columns: Partial<Record<T, number>>
  dataRows: ImportDataRow[]
}

/**
 * 按表头别名定位列
 * - aliases 里同一个字段可以配多个表头写法（如「字典编码 / 编码 / dictCode」）
 * - rows[0] 视为表头，dataRows 保留真实行号
 */
export function resolveImportLayout<T extends string>(rows: string[][], headerRowNumber: number, aliases: Record<T, string[]>): ImportLayout<T> {
  const header = (rows[0] ?? []).map(normalizeHeader)
  const columns: Partial<Record<T, number>> = {}
  for (const field of Object.keys(aliases) as T[]) {
    const index = header.findIndex(cell => aliases[field].includes(cell))
    if (index >= 0) {
      columns[field] = index
    }
  }
  const dataRows = rows.slice(1).map((cells, index) => ({ rowNumber: headerRowNumber + index + 1, cells }))
  return { columns, dataRows }
}

/** 读某列文本（列不存在或单元格为空返回空串，调用方不用判 undefined） */
export function pickCell<T extends string>(columns: Partial<Record<T, number>>, cells: string[], field: T): string {
  const index = columns[field]
  return index === undefined ? '' : String(cells[index] ?? '').trim()
}

/** 只校验行数上限（多工作表导入时，单张表可以为空） */
export function assertImportLimit(dataRows: ImportDataRow[]): void {
  if (dataRows.length > IMPORT_MAX_ROWS) {
    throw new BadRequestException(`单次最多导入 ${IMPORT_MAX_ROWS} 行，当前 ${dataRows.length} 行，请拆分后重试`)
  }
}

/** 行数校验：空文件、只有表头、超上限三种情况给出可操作的提示 */
export function assertImportRows(dataRows: ImportDataRow[]): void {
  if (!dataRows.length) {
    // 用 6104 而不是 1001：所有导入入口（角色/用户/字典/职级/岗位/公告/日志）都走这里，
    // 前端与监控按同一个码就能识别「文件没填数据」，不必解析各模块不同的文案。
    throw new BizException(BizErrorCode.IMPORT_EMPTY, '表头下方没有数据行，请填写后再导入', HttpStatus.BAD_REQUEST)
  }
  assertImportLimit(dataRows)
}

/** 状态文本归一：正常/启用/1 → '1'，停用/禁用/0 → '0'，其他返回 undefined（交给调用方报错） */
export function parseSwitchText(text: string): '1' | '0' | undefined {
  const value = normalizeHeader(text)
  if (!value) {
    return undefined
  }
  if (['1', '正常', '启用', '有效'].includes(value)) {
    return '1'
  }
  if (['0', '停用', '禁用', '无效'].includes(value)) {
    return '0'
  }
  return undefined
}

/** 正整数解析：用于排序/等级列，非数字或负数返回 undefined */
export function parsePositiveInt(text: string, fallback?: number): number | undefined {
  const value = String(text ?? '').trim()
  if (!value) {
    return fallback
  }
  if (!/^\d+$/.test(value)) {
    return undefined
  }
  return Number(value)
}
