import { LocalStorageProvider } from './local-storage.provider'
import { driverNotImplemented, type StorageProvider } from './storage-provider'

/**
 * 存储驱动工厂（进程内单例）
 *
 * FILE_STORAGE_DRIVER 切换：
 * - local（默认）：本地磁盘，行为与抽象层引入前完全一致；
 * - s3 / minio / oss：预留实现位 —— 按 StorageProvider 接口补全实现类后在此注册，
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
      throw driverNotImplemented(driver)
    default:
      throw new Error(`未知存储驱动「${driver}」，可选：local / s3 / minio / oss`)
  }
  return instance
}
