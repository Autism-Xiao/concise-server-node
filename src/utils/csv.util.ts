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
