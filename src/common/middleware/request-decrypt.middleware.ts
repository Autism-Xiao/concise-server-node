import { BadRequestException, Injectable, Logger, NestMiddleware } from '@nestjs/common'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { NextFunction, Request, Response } from 'express'

/**
 * 请求体加密（可选，AES-256-GCM + RSA-OAEP 信封加密）
 *
 * 设计为「开关默认关」的可选加固：ENCRYPT_ENABLED=true 才生效。
 * 适用于：登录口令等高敏字段在内网抓包/代理日志里不想明文出镜的场景。
 *
 * 协议（信封加密，`X-Encrypted: aes-rsa-v1`）：
 *   客户端：AES-256-GCM 随机密钥加密 JSON body → data(base64)；
 *           RSA 公钥加密 AES 密钥 → ek(base64)；iv(base64)；POST { ek, iv, data }
 *   服务端：RSA 私钥解出 AES 密钥 → GCM 解密 → 还原 req.body 后放行后续链路。
 *
 * 密钥管理（优先级）：
 *   1. 环境变量 REQUEST_ENCRYPT_RSA_PRIVATE_KEY / _PUBLIC_KEY（PEM 换行用 \n 转义）；
 *   2. 未配置则首次启动自动生成密钥对落 storage/keys/request-encrypt.json（自洽单机），
 *      生产多实例应显式配置同一对密钥，否则各实例公钥不一致。
 *
 * RSA-OAEP 只能加密 ≤ 245 字节（2048 位），所以只加密 AES 密钥而不加密 body 本体 ——
 * 这正是"信封加密"的用途；body 任意大小。
 */

/** RSA 私钥 + 公钥（PEM）；env 未配时自动生成落盘 */
let keyPair: { publicKeyPem: string; privateKeyPem: string } | null = null
let keyLoaded = false

/** 懒加载密钥对（首次用到才读盘/生成；ENCRYPT_ENABLED=false 时永不触发） */
function loadKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  if (keyLoaded && keyPair) return keyPair
  keyLoaded = true

  const envPrivate = (process.env.REQUEST_ENCRYPT_RSA_PRIVATE_KEY ?? '').trim()
  const envPublic = (process.env.REQUEST_ENCRYPT_RSA_PUBLIC_KEY ?? '').trim()
  if (envPrivate && envPublic) {
    keyPair = { privateKeyPem: envPrivate.replace(/\\n/g, '\n'), publicKeyPem: envPublic.replace(/\\n/g, '\n') }
    return keyPair
  }

  // 自动生成：文件落 storage/keys/（与文件存储同盘、不在 public 托管范围内）
  const keyFile = path.resolve(process.env.FILE_STORAGE_DIR?.trim() || path.join(process.cwd(), 'storage'), 'keys', 'request-encrypt.json')
  if (fs.existsSync(keyFile)) {
    keyPair = JSON.parse(fs.readFileSync(keyFile, 'utf8')) as { publicKeyPem: string; privateKeyPem: string }
    return keyPair
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  keyPair = { publicKeyPem: publicKey.toString(), privateKeyPem: privateKey.toString() }
  fs.mkdirSync(path.dirname(keyFile), { recursive: true })
  fs.writeFileSync(keyFile, JSON.stringify(keyPair, null, 2), { mode: 0o600 })
  return keyPair
}

/** 前端取公钥用（@Public 端点直接调） */
export function requestEncryptPublicKey(): string | null {
  if (!isEnabled()) return null
  return loadKeyPair().publicKeyPem
}

function isEnabled(): boolean {
  return (process.env.ENCRYPT_ENABLED ?? 'false').trim().toLowerCase() === 'true'
}

@Injectable()
export class RequestDecryptMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestDecryptMiddleware.name)

  use(req: Request, _res: Response, next: NextFunction): void {
    if (!isEnabled()) return next()
    const header = String(req.headers['x-encrypted'] ?? '')
    if (!header) return next()

    // 只有 JSON body 才走解密；GET/DELETE 无 body
    const body = req.body as Record<string, unknown> | undefined
    if (!body || typeof body !== 'object') return next()

    const ek = typeof body.ek === 'string' ? body.ek : ''
    const iv = typeof body.iv === 'string' ? body.iv : ''
    const data = typeof body.data === 'string' ? body.data : ''
    if (!ek || !iv || !data) {
      throw new BadRequestException('加密请求体格式不正确（需要 ek/iv/data 三个 base64 字段）')
    }

    try {
      // 1. RSA-OAEP 解出 AES 密钥
      const sessionKey = crypto.privateDecrypt(
        { key: loadKeyPair().privateKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from(ek, 'base64')
      )
      // 2. AES-256-GCM 解出 JSON body；约定 data = ciphertext + 16 字节 GCM authTag（与前端 WebCrypto 对齐）
      const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey, Buffer.from(iv, 'base64'))
      const raw = Buffer.from(data, 'base64')
      const ciphertext = raw.subarray(0, raw.length - 16)
      const authTag = raw.subarray(raw.length - 16)
      decipher.setAuthTag(authTag)
      const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')

      const parsed = JSON.parse(plain)
      if (parsed && typeof parsed === 'object') {
        req.body = parsed as Record<string, unknown>
        // 原始密文挂旁路字段：OperLogInterceptor 想记参数时不会把密文当业务数据
        ;(req as Request & { __encryptedOriginal?: string }).__encryptedOriginal = data.slice(0, 64)
      }
      return next()
    } catch (error) {
      this.logger.warn(`加密请求解密失败：${error instanceof Error ? error.message : String(error)}`)
      throw new BadRequestException('加密请求解密失败：密钥不匹配或数据被篡改')
    }
  }
}
