import type { Readable } from 'node:stream'

/**
 * 存储驱动接口 —— 文件中心的物理读写全部收口到这一层
 *
 * 设计约束：
 * - 上传永远是「先落本地临时文件（multer）→ 算 sha256 → 再交给驱动归位」，
 *   哈希/配额/文件头校验等逻辑不感知驱动；驱动只负责「按 key 存取字节」。
 * - key 形如 `2026/11/{sha256}.png`（内容寻址相对路径），不含驱动细节。
 * - 远程驱动（S3/MinIO/OSS）实现本接口即可接入，业务层零改动。
 */
export interface StorageProvider {
  /** 驱动名（local / s3 / oss …），日志与启动自检用 */
  readonly name: string

  /** key 对应的内容是否已存在（内容寻址下用于去重复用） */
  exists(key: string): Promise<boolean>

  /** 把本地临时文件归位到 key（跨盘/跨存储时驱动内部自行拷贝或上传） */
  saveFromTemp(tempPath: string, key: string): Promise<void>

  /** 直接写 buffer 到 key */
  write(key: string, buffer: Buffer): Promise<void>

  /** 打开读取流；range 传起止偏移（下载断点续传用） */
  openStream(key: string, range?: { start?: number; end?: number }): Promise<Readable>

  /** 读文件头 N 字节（验真实类型用） */
  readHead(key: string, bytes: number): Promise<Buffer>

  /** 删除物理内容（幂等：不存在不报错） */
  delete(key: string): Promise<void>
}

/** 驱动未就绪的统一报错文案 */
export function driverNotImplemented(name: string): Error {
  return new Error(`存储驱动「${name}」尚未实现：请安装对应 SDK 并按 StorageProvider 接口补全 src/shared/storage/ 下的实现类，或改回 FILE_STORAGE_DRIVER=local`)
}
