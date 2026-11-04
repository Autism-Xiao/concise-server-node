import { createHash, randomBytes } from 'crypto'
import { DES, mode, pad, enc, lib } from 'crypto-js'

/**
 * JeecgBoot 兼容密码工具：复现 Java PasswordUtil.encrypt(username, password, salt)
 *
 * Java 侧为 PBEWithMD5AndDES（RFC 2898 PBKDF1）：
 *   1. DK = MD5^1000(passwordBytes || saltBytes)，前 8 字节为 DES 密钥，后 8 字节为 IV
 *   2. 密文 = DES-CBC(key, iv, username 的 UTF-8 字节, PKCS5 填充)
 *   3. 结果为 8 字节密文的 16 位十六进制串
 *
 * Node 的 OpenSSL 3 已禁用 DES，因此 DES 部分用 crypto-js 实现；
 * 与 JeecgBoot sys_user 初始数据逐条验证一致（admin/123456 → cb362cfeefbf3d8d）。
 */

/** PBKDF1-MD5 迭代次数（与 Java PBEWithMD5AndDES 的 ITERATIONCOUNT 一致） */
const ITERATION_COUNT = 1000

/** JeecgBoot 兼容加密：返回 16 位十六进制密码串 */
export function encryptPassword(username: string, password: string, salt: string): string {
  const derived = deriveKeyIV(password, salt)
  const key = lib.WordArray.create(derived.key)
  const iv = lib.WordArray.create(derived.iv)
  const encrypted = DES.encrypt(enc.Utf8.parse(username), key, {
    iv,
    mode: mode.CBC,
    padding: pad.Pkcs7
  })
  return encrypted.ciphertext.toString(enc.Hex)
}

/** PBKDF1-MD5：MD5(password || salt) 迭代 1000 次，取前 8 字节为 key、后 8 字节为 IV */
function deriveKeyIV(password: string, salt: string): { key: Uint8Array; iv: Uint8Array } {
  let digest = createHash('md5')
    .update(Buffer.concat([Buffer.from(password, 'utf8'), Buffer.from(salt, 'ascii')]))
    .digest()
  for (let i = 1; i < ITERATION_COUNT; i++) {
    digest = createHash('md5').update(digest).digest()
  }
  return { key: digest.subarray(0, 8), iv: digest.subarray(8, 16) }
}

/** 生成 8 位随机盐（与 JeecgBoot sys_user.salt 同风格，如 RCGTeGiH） */
export function randomSalt(): string {
  return randomBytes(6)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8)
    .padEnd(8, '0')
}

/** 生成 32 位无连字符主键（对齐 sys_user.id varchar(32) 风格） */
export function randomId32(): string {
  return randomBytes(16).toString('hex')
}
