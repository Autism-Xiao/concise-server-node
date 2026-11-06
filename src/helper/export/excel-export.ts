import { StreamableFile } from '@nestjs/common'
import type { Response } from 'express'

import { formatDateTime } from '../../utils/csv.util'
import { setDownloadHeaders } from '../../utils/download.util'
import { buildXlsx, type XlsxCellStyleResolver, type XlsxCellValue, type XlsxColumn } from '../../utils/xlsx.util'

/**
 * Excel 导出公共件
 *
 * 各模块的导出流程是同一套：查数据 → 摆列 → 生成文件 → 设置下载头 → 返回流。
 * 差异只在「列怎么映射」和「哪些单元格上色」，所以这里收敛公共部分：
 * - 副标题统一格式：导出时间 · 操作人 · 共 N 条 · 筛选条件（各模块文案一致，前端不用分别处理）
 * - 下载响应头与文件名统一：ASCII 兜底名 + 中文显示名 + 导出日期
 * - 返回值统一 StreamableFile，控制器只写 `return sendXlsx({...})`
 */

/** 导出副标题原料 */
export interface ExportMeta {
  /** 操作人账号，缺省时副标题不出现该段 */
  operator?: string
  /** 本次导出的记录数 */
  count: number
  /** 生效的筛选描述，空串/undefined 会被忽略 */
  filters?: Array<string | undefined | null>
}

/**
 * 拼副标题，如：导出时间：2026-11-06 19:55:00 · 操作人：admin · 共 12 条记录 · 筛选：关键字=张，状态=正常
 * 筛选条件单独一段，避免用户拿到文件后不知道这份数据是怎么筛出来的
 */
export function buildExportSubtitle({ operator, count, filters = [] }: ExportMeta): string {
  const parts = [`导出时间：${formatDateTime(new Date())}`]
  if (operator) {
    parts.push(`操作人：${operator}`)
  }
  parts.push(`共 ${count} 条记录`)
  const active = filters.filter((item): item is string => Boolean(item))
  if (active.length) {
    parts.push(`筛选：${active.join('，')}`)
  }
  return parts.join(' · ')
}

/** 导出入参：res 用于写响应头，其余与 buildXlsx 的入参一一对应 */
export interface SendXlsxOptions {
  res: Response
  /** 工作表名（Excel 底部标签） */
  sheetName: string
  /** 大标题，通常与 sheetName 相同 */
  title?: string
  columns: XlsxColumn[]
  rows: XlsxCellValue[][]
  /** 页脚说明 */
  notes?: string[]
  /** 单元格着色 */
  cellStyle?: XlsxCellStyleResolver
  /** 副标题原料（时间/操作人/条数/筛选） */
  meta: ExportMeta
  /** ASCII 文件名前缀，如 `login-logs` */
  filePrefix: string
  /** 中文文件名（不含日期与扩展名），如 `登录日志` */
  displayName: string
}

/**
 * 生成 Excel 并写下载响应头
 *
 * 用法（控制器里一行返回）：
 * ```ts
 * return sendXlsx({ res, sheetName: '登录日志', columns, rows, meta: { operator, count: rows.length, filters }, filePrefix: 'login-logs', displayName: '登录日志' })
 * ```
 */
export async function sendXlsx({
  res,
  sheetName,
  title,
  columns,
  rows,
  notes,
  cellStyle,
  meta,
  filePrefix,
  displayName
}: SendXlsxOptions): Promise<StreamableFile> {
  const buffer = await buildXlsx(sheetName, columns, rows, {
    title: title ?? sheetName,
    subtitle: buildExportSubtitle(meta),
    notes,
    cellStyle
  })
  const today = formatDateTime(new Date()).slice(0, 10)
  setDownloadHeaders(res, `${filePrefix}-${Date.now()}.xlsx`, `${displayName}-${today}.xlsx`)
  return new StreamableFile(buffer)
}
