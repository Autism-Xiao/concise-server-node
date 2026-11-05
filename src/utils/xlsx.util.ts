import ExcelJS from 'exceljs'

/**
 * Excel 导出/导入工具
 *
 * 目标：导出的文件不只是「能打开」，而是能直接发给业务方的成品报表。
 * - 头部：合并单元格大标题 + 副标题（导出时间/操作人/条数），浅蓝底衬托
 * - 表头：深蓝底白字、居中、加粗、冻结，滚动时常驻
 * - 内容：斑马纹、细边框、垂直居中、列宽按内容自适应（中文按两个字符宽计算）
 * - 页脚：可选说明行（灰色斜体），用于写「密码留空表示不改」这类约定
 */

/** 单元格可写入的值 */
export type XlsxCellValue = string | number | null | undefined

/** 列定义：表头文字 + 可选 key/列宽/对齐（不传 key 时自动按序号生成） */
export interface XlsxColumn {
  header: string
  key?: string
  width?: number
  align?: 'left' | 'center' | 'right'
}

/** 单元格着色（按内容着色，如状态列：正常绿、冻结红） */
export interface XlsxCellStyle {
  fontColor?: string
  fillColor?: string
  bold?: boolean
}

/** 着色回调：rowIndex 从 0 开始（对应数据行），columnIndex 同理 */
export type XlsxCellStyleResolver = (rowIndex: number, columnIndex: number, value: string | number) => XlsxCellStyle | void

/** 单个工作表的渲染参数 */
export interface XlsxSheet {
  sheetName: string
  /** 大标题；不传则从表头开始（老调用方保持原结构） */
  title?: string
  /** 副标题，一般放「导出时间 · 操作人 · 共 N 条」 */
  subtitle?: string
  columns: XlsxColumn[]
  rows: XlsxCellValue[][]
  /** 页脚说明，多行依次写入 */
  notes?: string[]
  /** 数据单元格着色 */
  cellStyle?: XlsxCellStyleResolver
  /** 是否加自动筛选，默认有数据即加 */
  autoFilter?: boolean
}

/** 配色：比 Excel 默认灰更克制，打印和投屏都不刺眼 */
const PALETTE = {
  titleText: 'FF16324F',
  titleBg: 'FFEAF2FB',
  brand: 'FF1D4E89',
  brandDeep: 'FF153D6B',
  zebra: 'FFF5F8FC',
  border: 'FFD9E2EC',
  text: 'FF1F2937',
  muted: 'FF7A8699'
} as const

/** Excel 单元格上限 32767 字符，这里留足余量并加省略号，避免写坏文件 */
const MAX_CELL_CHARS = 5000

/** 列宽下限/上限（字符数），太窄看不清、太宽一屏放不下 */
const MIN_COLUMN_WIDTH = 8
const MAX_COLUMN_WIDTH = 46

/** 中文字符按 2 个字符宽度估算，让列宽贴合实际显示 */
function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    width += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char) ? 2 : 1
  }
  return width
}

/** 归一化写入值：null/undefined 变空串，超长文本截断并加省略号 */
function normalizeValue(value: XlsxCellValue): string | number {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'number') {
    return value
  }
  const text = String(value)
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…` : text
}

/** 单行文本的最大显示宽度（多行取最长那行） */
function maxLineWidth(value: string | number): number {
  return String(value)
    .split(/\r?\n/)
    .reduce((max, line) => Math.max(max, displayWidth(line)), 0)
}

/** 按表头 + 内容宽度自适应列宽 */
function resolveColumnWidths(columns: XlsxColumn[], rows: XlsxCellValue[][]): number[] {
  return columns.map((column, index) => {
    if (column.width) {
      return column.width
    }
    const headerWidth = displayWidth(column.header) + 4
    const contentWidth = rows.reduce((max, row) => Math.max(max, maxLineWidth(normalizeValue(row[index]))), 0) + 2
    return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, headerWidth, contentWidth))
  })
}

/** 把列序号转成 Excel 列字母（1 → A，27 → AA） */
function columnLetter(index: number): string {
  let letter = ''
  let current = index
  while (current > 0) {
    const remainder = (current - 1) % 26
    letter = String.fromCharCode(65 + remainder) + letter
    current = Math.floor((current - 1) / 26)
  }
  return letter
}

/** 细边框：统一走浅灰，避免每格黑框显得笨重 */
function thinBorder(): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: PALETTE.border } }
  return { top: side, left: side, bottom: side, right: side }
}

/** 渲染单个工作表（内部方法，导出统一走 buildWorkbook） */
function renderSheet(workbook: ExcelJS.Workbook, sheet: XlsxSheet): ExcelJS.Worksheet {
  const hasTitle = Boolean(sheet.title)
  const columnCount = Math.max(sheet.columns.length, 1)
  const lastLetter = columnLetter(columnCount)
  const headerRowNumber = hasTitle ? 4 : 1

  const worksheet = workbook.addWorksheet(sheet.sheetName, {
    views: [{ state: 'frozen', ySplit: headerRowNumber, showGridLines: false }],
    pageSetup: {
      orientation: columnCount > 6 ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }
    }
  })
  worksheet.properties.defaultRowHeight = 20

  // ---- 头部：大标题 + 副标题（合并整行，浅蓝底） ----
  if (sheet.title) {
    const titleRow = worksheet.getRow(1)
    titleRow.getCell(1).value = sheet.title
    worksheet.mergeCells(`A1:${lastLetter}1`)
    titleRow.height = 38
    titleRow.getCell(1).font = { size: 16, bold: true, color: { argb: PALETTE.titleText } }
    titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.titleBg } }

    const subtitleRow = worksheet.getRow(2)
    subtitleRow.getCell(1).value = sheet.subtitle ?? ''
    worksheet.mergeCells(`A2:${lastLetter}2`)
    subtitleRow.height = 20
    subtitleRow.getCell(1).font = { size: 10, color: { argb: PALETTE.muted } }
    subtitleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    subtitleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.titleBg } }

    // 标题与表头之间留一条空白行，视觉上分组
    worksheet.getRow(3).height = 6
  }

  // ---- 表头：深蓝底白字，居中加粗 ----
  const headerRow = worksheet.getRow(headerRowNumber)
  sheet.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1)
    cell.value = column.header
    cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.brand } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = thinBorder()
  })
  headerRow.height = 26

  // ---- 数据：斑马纹 + 细边框，按列对齐 ----
  const widths = resolveColumnWidths(sheet.columns, sheet.rows)
  sheet.columns.forEach((column, index) => {
    worksheet.getColumn(index + 1).width = widths[index]
  })

  sheet.rows.forEach((row, rowIndex) => {
    const target = worksheet.getRow(headerRowNumber + rowIndex + 1)
    // 偶数行铺浅蓝底，奇数行保持白底
    const zebra = rowIndex % 2 === 1
    sheet.columns.forEach((column, columnIndex) => {
      const value = normalizeValue(row[columnIndex])
      const cell = target.getCell(columnIndex + 1)
      cell.value = value
      cell.border = thinBorder()
      cell.font = { size: 10, color: { argb: PALETTE.text } }
      cell.alignment = {
        vertical: 'middle',
        horizontal: column.align ?? (typeof value === 'number' ? 'right' : 'left'),
        wrapText: false
      }
      if (zebra) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.zebra } }
      }
      const custom = sheet.cellStyle?.(rowIndex, columnIndex, value)
      if (custom?.fontColor) {
        cell.font = { ...cell.font, color: { argb: custom.fontColor }, ...(custom.bold ? { bold: true } : {}) }
      }
      if (custom?.fillColor) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: custom.fillColor } }
      }
    })
    target.height = 20
  })

  // ---- 自动筛选：表头到最后一行的数据区 ----
  if (sheet.autoFilter !== false && sheet.rows.length > 0) {
    worksheet.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: headerRowNumber + sheet.rows.length, column: columnCount }
    }
  }

  // ---- 页脚说明：数据下方空一行，再逐行写灰色斜体小字 ----
  if (sheet.notes?.length) {
    const startRow = headerRowNumber + sheet.rows.length + 2
    worksheet.getRow(startRow - 1).height = 8
    sheet.notes.forEach((note, index) => {
      const row = worksheet.getRow(startRow + index)
      row.getCell(1).value = note
      worksheet.mergeCells(`A${startRow + index}:${lastLetter}${startRow + index}`)
      row.height = 18
      row.getCell(1).font = { size: 9, italic: true, color: { argb: PALETTE.muted } }
      row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    })
  }

  // 打印时重复表头行
  worksheet.pageSetup.printTitlesRow = `${headerRowNumber}:${headerRowNumber}`
  return worksheet
}

/** 多工作表导出：报表 + 示例页等场景复用同一个工作簿样式 */
export async function buildWorkbook(sheets: XlsxSheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'concise'
  workbook.lastModifiedBy = 'concise'
  workbook.created = new Date()
  workbook.modified = new Date()
  sheets.forEach(sheet => renderSheet(workbook, sheet))
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

/**
 * 生成 xlsx 文件 Buffer（兼容老调用）
 * - 传 options.title 即渲染成品报表样式（大标题 + 副标题 + 斑马纹 + 说明）
 * - 不传则退化为「表头 + 数据」，样式已统一升级
 */
export async function buildXlsx(
  sheetName: string,
  columns: XlsxColumn[],
  rows: XlsxCellValue[][],
  options: Omit<XlsxSheet, 'sheetName' | 'columns' | 'rows'> = {}
): Promise<Buffer> {
  return buildWorkbook([{ sheetName, columns, rows, ...options }])
}

/**
 * 生成导入模板
 * - 第一个工作表只有标题、填写说明、表头（诱导用户照着填，不会把示例当数据导进去）
 * - 第二个工作表「填写示例」放示例行，读数据时只读第一个表，示例不会被误导入
 */
export interface ImportTemplateOptions {
  sheetName: string
  title: string
  /** 填写说明，逐行写在标题下方 */
  notes: string[]
  columns: Array<{ header: string; width?: number; required?: boolean; hint?: string }>
  samples?: XlsxCellValue[][]
}

/** 必填列表头追加红色星号，一眼看出哪些必须填 */
function decorateRequiredHeader(worksheet: ExcelJS.Worksheet, headerRowNumber: number, columns: ImportTemplateOptions['columns']): void {
  columns.forEach((column, index) => {
    if (!column.required) {
      return
    }
    const cell = worksheet.getRow(headerRowNumber).getCell(index + 1)
    const star = cell.value as ExcelJS.CellValue
    cell.value = {
      richText: [
        { text: String(star ?? ''), font: { bold: true, color: { argb: 'FFFFFFFF' } } },
        { text: ' *', font: { bold: true, color: { argb: 'FFFFD166' } } }
      ]
    }
  })
}

export async function buildImportTemplateXlsx(options: ImportTemplateOptions): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'concise'
  workbook.created = new Date()

  const columnCount = Math.max(options.columns.length, 1)
  const lastLetter = columnLetter(columnCount)
  const notesTop = 2
  const headerRowNumber = notesTop + Math.max(options.notes.length, 1) + 1

  const sheet = workbook.addWorksheet(options.sheetName, {
    views: [{ state: 'frozen', ySplit: headerRowNumber, showGridLines: false }],
    pageSetup: { orientation: columnCount > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  })

  // 标题
  sheet.getRow(1).getCell(1).value = options.title
  sheet.mergeCells(`A1:${lastLetter}1`)
  sheet.getRow(1).height = 38
  sheet.getRow(1).getCell(1).font = { size: 16, bold: true, color: { argb: PALETTE.titleText } }
  sheet.getRow(1).getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  sheet.getRow(1).getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.titleBg } }

  // 填写说明
  options.notes.forEach((note, index) => {
    const rowNumber = notesTop + index
    sheet.getRow(rowNumber).getCell(1).value = note
    sheet.mergeCells(`A${rowNumber}:${lastLetter}${rowNumber}`)
    sheet.getRow(rowNumber).height = 18
    sheet.getRow(rowNumber).getCell(1).font = { size: 10, color: { argb: PALETTE.muted } }
    sheet.getRow(rowNumber).getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  })

  // 表头
  const headerRow = sheet.getRow(headerRowNumber)
  options.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1)
    cell.value = column.header
    cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: column.required ? PALETTE.brandDeep : PALETTE.brand } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = thinBorder()
    if (column.hint) {
      cell.note = column.hint
    }
    sheet.getColumn(index + 1).width = column.width ?? Math.max(14, displayWidth(column.header) + 8)
  })
  headerRow.height = 28
  decorateRequiredHeader(sheet, headerRowNumber, options.columns)

  // 数据区给 3 行空行预置边框，方便用户直接往里填
  for (let index = 1; index <= 3; index += 1) {
    const row = sheet.getRow(headerRowNumber + index)
    options.columns.forEach((_, columnIndex) => {
      const cell = row.getCell(columnIndex + 1)
      cell.border = thinBorder()
      cell.alignment = { vertical: 'middle', horizontal: 'left' }
    })
    row.height = 20
  }

  // 示例页
  if (options.samples?.length) {
    const sampleSheet = workbook.addWorksheet('填写示例', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] })
    options.columns.forEach((column, index) => {
      const cell = sampleSheet.getRow(1).getCell(index + 1)
      cell.value = column.header
      cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.brand } }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      cell.border = thinBorder()
      sampleSheet.getColumn(index + 1).width = column.width ?? Math.max(14, displayWidth(column.header) + 8)
    })
    sampleSheet.getRow(1).height = 26
    options.samples.forEach((sample, rowIndex) => {
      const row = sampleSheet.getRow(rowIndex + 2)
      options.columns.forEach((_, columnIndex) => {
        const cell = row.getCell(columnIndex + 1)
        cell.value = normalizeValue(sample[columnIndex])
        cell.border = thinBorder()
        cell.font = { size: 10, color: { argb: PALETTE.muted } }
        cell.alignment = { vertical: 'middle', horizontal: 'left' }
        if (rowIndex % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETTE.zebra } }
        }
      })
      row.height = 20
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

/** 读取选项：表头定位 */
export interface ReadXlsxOptions {
  /**
   * 表头关键字：传入后自动跳过标题/说明行，把「第一个命中关键字的行」当作表头
   * 导入模板头部有大标题，不定位表头会把标题当列名解析
   */
  headerKeys?: string[]
}

/** 解析结果：rows 含表头行，headerRow 为表头在 Excel 中的真实行号（导入报错定位用） */
export interface XlsxTable {
  rows: string[][]
  headerRow: number
}

/**
 * 解析 xlsx 第一个工作表
 * - 用 cell.text 取「显示值」，日期/数字/公式结果都能拿到可读文本
 * - 丢弃整行空白（Excel 常见的尾部空行）
 * - 传 headerKeys 时跳过标题/说明行，从命中关键字的表头行开始返回
 */
export async function readXlsxTable(buffer: Buffer, options: ReadXlsxOptions = {}): Promise<XlsxTable> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) {
    return { rows: [], headerRow: 1 }
  }
  /** 保留 Excel 真实行号，方便把「第几行出错」报给用户 */
  const rows: string[][] = []
  const rowNumbers: number[] = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cellCount = Math.max(sheet.columnCount, row.cellCount)
    const cells: string[] = []
    for (let index = 1; index <= cellCount; index += 1) {
      cells.push((row.getCell(index).text ?? '').trim())
    }
    if (cells.some(cell => cell !== '')) {
      rows.push(cells)
      rowNumbers.push(rowNumber)
    }
  })

  // 表头可能带必填标记（「登录账号 *」）或前后空格，归一化后比较
  const normalizeHeader = (text: string) => text.replace(/[\s*＊]/g, '').toLowerCase()
  const keys = options.headerKeys?.map(normalizeHeader)
  if (keys?.length) {
    const headerIndex = rows.findIndex(row => row.some(cell => keys.includes(normalizeHeader(cell))))
    if (headerIndex > 0) {
      return { rows: rows.slice(headerIndex), headerRow: rowNumbers[headerIndex] }
    }
  }
  return { rows, headerRow: rowNumbers[0] ?? 1 }
}

/** 兼容老调用：只要二维数组（含表头行） */
export async function readXlsxRows(buffer: Buffer, options: ReadXlsxOptions = {}): Promise<string[][]> {
  const table = await readXlsxTable(buffer, options)
  return table.rows
}
