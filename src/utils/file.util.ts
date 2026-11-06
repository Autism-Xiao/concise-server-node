import fs from 'node:fs'
import path from 'node:path'

export enum FileType {
  IMAGE = '图片',
  TXT = '文档',
  MUSIC = '音乐',
  VIDEO = '视频',
  OTHER = '其他'
}

/** 按扩展名归类文件类型 */
export function getFileType(extName: string): FileType {
  const documents = 'txt doc pdf ppt pps xlsx xls docx'
  const music = 'mp3 wav wma mpa ram ra aac aif m4a'
  const video = 'avi mpg mpe mpeg asf wmv mov qt rm mp4 flv m4v webm ogv ogg'
  const image = 'bmp dib pcp dif wmf gif jpg tif eps psd cdr iff tga pcd mpt png jpeg'
  if (image.includes(extName)) return FileType.IMAGE
  if (documents.includes(extName)) return FileType.TXT
  if (music.includes(extName)) return FileType.MUSIC
  if (video.includes(extName)) return FileType.VIDEO
  return FileType.OTHER
}

/** 取不含点的小写扩展名 */
export function getExtname(fileName: string): string {
  return path.extname(fileName).replace('.', '').toLowerCase()
}

/** 字节数转可读大小，如 "1.5 MB" */
export function getSize(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(Math.max(decimals, 0)))} ${sizes[i]}`
}

/**
 * 取安全的文件名（不含目录）
 *
 * 用户上传的 originalname 完全可控，可能是 `../../etc/passwd` 或 `a/b.png`：
 * 直接拼进落盘路径就是目录穿越，因此先去目录分隔符、再去非法字符，最后兜底 'file'。
 */
export function sanitizeFileName(fileName: string): string {
  const base = path.basename(String(fileName ?? '').replace(/\\/g, '/'))
  // eslint-disable-next-line no-control-regex -- 需要剔除控制字符（含 \0）
  const cleaned = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim()
  return cleaned || 'file'
}

/**
 * 重命名：原名 + 时间戳 + 扩展名，防覆盖
 * @param extOverride 扩展名覆盖（按文件头识别出的真实类型，避免「.html 里装着 png」）
 */
export function fileRename(fileName: string, extOverride?: string): string {
  const safeName = sanitizeFileName(fileName)
  const originalExt = path.extname(safeName)
  const ext = (extOverride ?? originalExt.replace('.', '')).toLowerCase()
  const base = path.posix.basename(safeName, originalExt).slice(0, 80) || 'file'
  const time = new Date().toISOString().replace(/\D/g, '').slice(0, 17)
  return `${base}-${time}${ext ? `.${ext}` : ''}`
}

/** 数据库中存的相对访问路径 */
export function getFilePath(name: string, currentDate: string, type: string): string {
  return `/upload/${currentDate}/${type}/${name}`
}

/** 当前日期目录名 YYYY-MM-DD */
export function getCurrentDate(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 把 Buffer 落盘到 public/upload/{日期}/{类型}/ 目录 */
export async function saveLocalFile(buffer: Buffer, name: string, currentDate: string, type: string): Promise<void> {
  const dir = path.join(process.cwd(), 'public/upload', currentDate, type)
  const target = path.resolve(dir, name)
  // 兜底防穿越：最终路径必须仍在目标目录内（name 已在 fileRename 里清洗过，这里是二次保险）
  if (!target.startsWith(path.resolve(dir) + path.sep)) {
    throw new Error(`非法的文件名：${name}`)
  }
  await fs.promises.mkdir(dir, { recursive: true })
  await fs.promises.writeFile(target, buffer)
}

/** 按相对访问路径删除本地文件（失败静默，不阻断主流程） */
export function deleteFile(relativePath: string): void {
  fs.unlink(path.join(process.cwd(), 'public', relativePath), () => {})
}
