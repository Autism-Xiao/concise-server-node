import { LocalStorageProvider } from './local-storage.provider'
import { S3StorageProvider } from './s3-storage.provider'
import { type StorageProvider } from './storage-provider'

/**
 * 存储驱动工厂（进程内单例）
 *
 * FILE_STORAGE_DRIVER 切换：
 * - local（默认）：本地磁盘，行为与抽象层引入前完全一致；
 * - s3 / minio / oss：S3 兼容对象存储（同一 SigV4 实现，只差驱动名/日志展示）——
 *   阿里云 OSS、腾讯云 COS、MinIO、R2 等均可，需配齐 FILE_STORAGE_S3_* 环境变量。
 *   业务层（file.service / file.v1.controller）零改动。
 */
let instance: StorageProvider | null = null

export function storageProvider(): StorageProvider {
  if (instance) return instance
  const driver = process.env.FILE_STORAGE_DRIVER?.trim() || 'local'
  switch (driver) {
    case 'local':
      instance = new LocalStorageProvider()
      break
    case 's3':
    case 'minio':
    case 'oss':
      instance = new S3StorageProvider(driver)
      break
    default:
      throw new Error(`未知存储驱动「${driver}」，可选：local / s3 / minio / oss`)
  }
  return instance
}
