import type { Response } from 'express'

/**
 * 拼接 Excel 下载响应头
 * - filename：ASCII 兜底，老浏览器/老旧下载器不认 filename* 时用它
 * - filename*：RFC 5987 UTF-8 编码，保住中文文件名（前端从该字段取真实文件名）
 */
export function setDownloadHeaders(res: Response, asciiName: string, chineseName: string): void {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(chineseName)}`)
}
