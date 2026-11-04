/** CSV 单元格转义：含逗号/引号/换行的值用双引号包裹，内部引号翻倍 */
function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return ''
  }
  const text = String(value)
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/**
 * 把表头 + 二维行数据拼成 CSV 文本
 * 前置 UTF-8 BOM，保证 Excel 直接打开中文不乱码；行尾统一 \r\n
 */
export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [headers, ...rows].map(row => row.map(escapeCell).join(','))
  return `\uFEFF${lines.join('\r\n')}`
}

/**
 * 解析 CSV 文本为二维数组（与 toCsv 对称）
 * - 自动去掉 UTF-8 BOM
 * - 支持双引号包裹的单元格（内部逗号、换行、"" 转义的双引号）
 * - 兼容 \r\n / \n / \r 三种行尾
 * - 丢弃全空白行（Excel 另存常见的尾部空行）
 */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
      continue
    }
    if (char === ',') {
      row.push(cell)
      cell = ''
      continue
    }
    if (char === '\n' || char === '\r') {
      // \r 单独出现（老式 Mac 行尾）或 \r\n 都当作一次换行
      if (char === '\r' && source[i + 1] === '\n') {
        i += 1
      }
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }
    cell += char
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter(cells => cells.some(value => value.trim() !== ''))
}

/** 格式化为本地时间字符串 YYYY-MM-DD HH:mm:ss（东八区） */
export function formatDateTime(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return ''
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
