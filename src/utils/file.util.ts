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

/** 重命名：原名 + 时间戳 + 扩展名，防覆盖 */
export function fileRename(fileName: string): string {
  const name = fileName.split('.')[0]
  const extName = path.extname(fileName)
  const time = new Date().toISOString().replace(/\D/g, '').slice(0, 17)
  return `${name}-${time}${extName}`
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
  await fs.promises.mkdir(dir, { recursive: true })
  await fs.promises.writeFile(path.join(dir, name), buffer)
}

/** 按相对访问路径删除本地文件（失败静默，不阻断主流程） */
export function deleteFile(relativePath: string): void {
  fs.unlink(path.join(process.cwd(), 'public', relativePath), () => {})
}
