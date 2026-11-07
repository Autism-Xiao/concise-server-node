import { BadRequestException } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

import type { StorageProvider } from './storage-provider'

/** 本地磁盘驱动：内容寻址目录 FILE_STORAGE_DIR（默认 storage/files） */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local'
  private readonly root = path.resolve(process.env.FILE_STORAGE_DIR?.trim() || path.join(process.cwd(), 'storage/files'))

  /** key → 绝对路径；必须仍在存储根目录内（防脏数据穿越） */
  resolve(key: string): string {
    const target = path.resolve(this.root, key)
    if (!target.startsWith(this.root + path.sep)) {
      throw new BadRequestException('非法的存储路径')
    }
    return target
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.resolve(key))
  }

  /** 临时文件与存储目录同盘 rename（原子、零拷贝）；跨盘 EXDEV 退化成拷贝 */
  async saveFromTemp(tempPath: string, key: string): Promise<void> {
    const absolute = this.resolve(key)
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true })
    try {
      await fs.promises.rename(tempPath, absolute)
    } catch {
      await fs.promises.copyFile(tempPath, absolute)
    }
  }

  async write(key: string, buffer: Buffer): Promise<void> {
    const absolute = this.resolve(key)
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true })
    await fs.promises.writeFile(absolute, buffer)
  }

  async openStream(key: string, range?: { start?: number; end?: number }): Promise<Readable> {
    return fs.createReadStream(this.resolve(key), range?.start !== undefined || range?.end !== undefined ? range : undefined)
  }

  async readHead(key: string, bytes: number): Promise<Buffer> {
    const handle = await fs.promises.open(this.resolve(key), 'r')
    try {
      const buffer = Buffer.alloc(bytes)
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  async delete(key: string): Promise<void> {
    await fs.promises.unlink(this.resolve(key)).catch(() => undefined)
  }
}
