import ExcelJS from 'exceljs'

/** 列定义：表头文字 + 可选 key/列宽（不传 key 时自动按序号生成） */
export interface XlsxColumn {
  header: string
  key?: string
  width?: number
}

/**
 * 生成 xlsx 文件 Buffer
 * - 首行表头加粗 + 浅灰底 + 冻结（滚动时表头常驻）
 * - 有数据时首行加自动筛选
 * - 单元格按原值写入（数字保持数字类型，Excel 里可直接求和）
 */
export async function buildXlsx(sheetName: string, columns: XlsxColumn[], rows: Array<Array<string | number | null | undefined>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'concise'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = columns.map((column, index) => ({
    header: column.header,
    key: column.key ?? `col_${index}`,
    width: column.width ?? 18
  }))
  rows.forEach(row => sheet.addRow(row.map(cell => cell ?? '')))

  const header = sheet.getRow(1)
  header.font = { bold: true }
  header.height = 22
  header.alignment = { vertical: 'middle' }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F4F7' } }

  if (rows.length) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

/**
 * 解析 xlsx 第一个工作表为二维字符串数组
 * - 用 cell.text 取「显示值」，日期/数字/公式结果都能拿到可读文本
 * - 丢弃整行空白（Excel 常见的尾部空行）
 */
export async function readXlsxRows(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) {
    return []
  }
  const rows: string[][] = []
  sheet.eachRow({ includeEmpty: false }, row => {
    const cellCount = Math.max(sheet.columnCount, row.cellCount)
    const cells: string[] = []
    for (let index = 1; index <= cellCount; index += 1) {
      cells.push((row.getCell(index).text ?? '').trim())
    }
    if (cells.some(cell => cell !== '')) {
      rows.push(cells)
    }
  })
  return rows
}
