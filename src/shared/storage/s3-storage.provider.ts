import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { Readable } from 'node:stream'

import type { StorageProvider } from './storage-provider'

/**
 * S3 兼容对象存储驱动（原生 SigV4 签名，零 SDK 依赖）
 *
 * 适配任何 AWS Signature V4 兼容服务：
 * - 阿里云 OSS（S3 兼容模式）、腾讯云 COS、MinIO、Backblaze B2、Cloudflare R2、AWS S3 本尊
 *
 * 环境变量（FILE_STORAGE_DRIVER=s3/minio/oss 时必填）：
 * - FILE_STORAGE_S3_ENDPOINT     形如 https://oss-cn-hangzhou.aliyuncs.com（不带 bucket 路径）
 * - FILE_STORAGE_S3_REGION       区域标识，如 cn-hangzhou / ap-guangzhou / us-east-1
 * - FILE_STORAGE_S3_BUCKET       桶名
 * - FILE_STORAGE_S3_ACCESS_KEY   AccessKeyId / SecretId
 * - FILE_STORAGE_S3_SECRET_KEY   AccessKeySecret / SecretKey（密钥，只放环境变量，不进 sys_config）
 * - FILE_STORAGE_S3_PATH_STYLE   可选，true = 路径风格（MinIO/R2 需要），默认虚拟主机风格
 *
 * 签名口径：内容寻址 key 直接做对象名（沿用 local 驱动的扁平 key 语义），
 * 上传用 PUT（body 整段入签名），读取用 GET + Range（断点续传/head 校验都走它）。
 */
export class S3StorageProvider implements StorageProvider {
  readonly name: string
  private readonly endpoint: string
  private readonly region: string
  private readonly bucket: string
  private readonly accessKey: string
  private readonly secretKey: string
  private readonly pathStyle: boolean

  constructor(driverName = 's3') {
    this.name = driverName
    this.endpoint = (process.env.FILE_STORAGE_S3_ENDPOINT ?? '').trim().replace(/\/+$/, '')
    this.region = (process.env.FILE_STORAGE_S3_REGION ?? '').trim()
    this.bucket = (process.env.FILE_STORAGE_S3_BUCKET ?? '').trim()
    this.accessKey = (process.env.FILE_STORAGE_S3_ACCESS_KEY ?? '').trim()
    this.secretKey = process.env.FILE_STORAGE_S3_SECRET_KEY ?? ''
    this.pathStyle = (process.env.FILE_STORAGE_S3_PATH_STYLE ?? '').trim().toLowerCase() === 'true'
    if (!this.endpoint || !this.region || !this.bucket || !this.accessKey || !this.secretKey) {
      throw new BadRequestException('S3 存储驱动未配置完整：需要 FILE_STORAGE_S3_ENDPOINT / REGION / BUCKET / ACCESS_KEY / SECRET_KEY 五个环境变量')
    }
  }

  /** 对象 URL（path-style 与 virtual-host 两种风格） */
  private objectUrl(key: string): { url: URL; host: string; canonicalPath: string } {
    if (this.pathStyle) {
      const url = new URL(`${this.endpoint}/${this.bucket}/${encodeKeyPath(key)}`)
      return { url, host: url.host, canonicalPath: `/${this.bucket}/${encodeKeyPath(key)}` }
    }
    const host = `${this.bucket}.${new URL(this.endpoint).host}`
    const url = new URL(`${new URL(this.endpoint).protocol}//${host}/${encodeKeyPath(key)}`)
    return { url, host, canonicalPath: `/${encodeKeyPath(key)}` }
  }

  /** SigV4 签名并发出请求；非 2xx 时给出带状态码与响应片段的错误 */
  private async signed(method: 'GET' | 'PUT' | 'HEAD' | 'DELETE', key: string, body?: Buffer, range?: { start?: number; end?: number }): Promise<Response> {
    const { url, host, canonicalPath } = this.objectUrl(key)
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '') // YYYYMMDDTHHMMSSZ
    const dateStamp = amzDate.slice(0, 8)
    const payloadHash = body ? crypto.createHash('sha256').update(body).digest('hex') : crypto.createHash('sha256').update('').digest('hex')

    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate
    }
    if (range?.start !== undefined) {
      headers.range = `bytes=${range.start}-${range.end ?? ''}`
    }

    const signedHeaders = Object.keys(headers).sort().join(';')
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map(h => `${h}:${headers[h].trim()}\n`)
      .join('')
    const canonicalRequest = [method, canonicalPath, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')

    const kDate = crypto.createHmac('sha256', `AWS4${this.secretKey}`).update(dateStamp).digest()
    const kRegion = crypto.createHmac('sha256', kDate).update(this.region).digest()
    const kService = crypto.createHmac('sha256', kRegion).update('s3').digest()
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest()
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')

    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

    const bodyInit = body && body.length ? new Uint8Array(body) : undefined
    return fetch(url, { method, headers, body: bodyInit, signal: AbortSignal.timeout(30_000) })
  }

  private async ensureOk(res: Response, action: string): Promise<void> {
    if (res.ok) return
    const snippet = await res.text().catch(() => '')
    throw new ServiceUnavailableException(`对象存储${action}失败（HTTP ${res.status}）：${snippet.slice(0, 160)}`)
  }

  async exists(key: string): Promise<boolean> {
    const res = await this.signed('HEAD', key)
    if (res.status === 404) return false
    await this.ensureOk(res, '查询')
    return true
  }

  /** 临时文件 → 对象存储：流式读入再 PUT（对象服务没有服务端 rename） */
  async saveFromTemp(tempPath: string, key: string): Promise<void> {
    const buffer = await fs.promises.readFile(tempPath)
    await this.write(key, buffer)
  }

  async write(key: string, buffer: Buffer): Promise<void> {
    const res = await this.signed('PUT', key, buffer)
    await this.ensureOk(res, '上传')
  }

  async openStream(key: string, range?: { start?: number; end?: number }): Promise<Readable> {
    const res = await this.signed('GET', key, undefined, range)
    await this.ensureOk(res, '下载')
    return Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
  }

  async readHead(key: string, bytes: number): Promise<Buffer> {
    const res = await this.signed('GET', key, undefined, { start: 0, end: bytes - 1 })
    await this.ensureOk(res, '读取')
    return Buffer.from(await res.arrayBuffer())
  }

  /** 幂等删除：404 视为已删除 */
  async delete(key: string): Promise<void> {
    const res = await this.signed('DELETE', key)
    if (res.status === 404) return
    await this.ensureOk(res, '删除')
  }
}

/** 对象 key 编码：逐段 encodeURIComponent（key 是内容寻址十六进制，通常无特殊字符） */
function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}
