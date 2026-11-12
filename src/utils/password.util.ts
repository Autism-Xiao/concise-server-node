import { createHash, randomBytes } from 'crypto'
import { DES, mode, pad, enc, lib } from 'crypto-js'
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2'

/**
 * 历史密码兼容工具：复现 Java PasswordUtil.encrypt(username, password, salt)
 *
 * Java 侧为 PBEWithMD5AndDES（RFC 2898 PBKDF1）：
 *   1. DK = MD5^1000(passwordBytes || saltBytes)，前 8 字节为 DES 密钥，后 8 字节为 IV
 *   2. 密文 = DES-CBC(key, iv, username 的 UTF-8 字节, PKCS5 填充)
 *   3. 结果为 8 字节密文的 16 位十六进制串
 *
 * Node 的 OpenSSL 3 已禁用 DES，因此 DES 部分用 crypto-js 实现；
 * 与 sys_user 初始数据逐条验证一致（admin/123456 → cb362cfeefbf3d8d）。
 */

/** PBKDF1-MD5 迭代次数（与 Java PBEWithMD5AndDES 的 ITERATIONCOUNT 一致） */
const ITERATION_COUNT = 1000

/** 历史格式加密：返回 16 位十六进制密码串 */
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

/** 生成 8 位随机盐（与 sys_user.salt 同风格，如 RCGTeGiH） */
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

/* ------------------------------------------------------------------ *
 * 新密码算法：argon2id（@node-rs/argon2，Rust 预编译，无本地编译依赖）
 *
 * 为什么换掉旧的 PBEWithMD5AndDES：
 *  - 单轮 MD5 + DES 早已不是密码哈希算法，抗 GPU 爆破能力接近于零；
 *  - 密钥材料只有 8 字节，且盐是 8 位 ASCII，输入空间很小。
 *
 * 参数取 OWASP 2024 推荐的「19 MiB / 2 轮 / 1 并行」，实测单次约 18ms，
 * 输出 97 字符的 PHC 串（$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>），
 * sys_user.password 是 varchar(255)，余量充足。
 *
 * 兼容策略：老数据不批量重算（避免上线时把库写坏），改为「登录时透明升级」——
 * 校验通过后用 argon2id 覆盖写回，见 UserService.verifyPassword / upgradePasswordHash。
 * ------------------------------------------------------------------ */

/** argon2id PHC 串前缀，用于区分新旧算法（老格式是 16/32/48 位纯十六进制） */
const ARGON2_PREFIX = '$argon2id$'

/**
 * argon2id 参数（OWASP 推荐档位）
 *
 * 不显式传 algorithm：@node-rs/argon2 默认就是 Argon2id（其 Algorithm 是 const enum，
 * 项目开启 isolatedModules 后无法当值引用）。哈希结果以 $argon2id$ 开头，
 * 若哪天默认值变了，isArgon2Hash 会立刻失配，属于可被发现的失败。
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
} as const

/** 生成 argon2id 密码哈希（异步：约 18ms，不要放在同步路径里循环调用） */
export function hashPassword(plainPassword: string): Promise<string> {
  return argonHash(plainPassword, ARGON2_OPTIONS)
}

/** 判断库里的密码串是否已是 argon2id 格式 */
export function isArgon2Hash(stored?: string | null): boolean {
  return !!stored && stored.startsWith(ARGON2_PREFIX)
}

/** 校验 argon2id 密码；格式非法/库数据损坏一律返回 false，不抛异常 */
export async function verifyArgon2Password(stored: string, plainPassword: string): Promise<boolean> {
  try {
    return await argonVerify(stored, plainPassword)
  } catch {
    return false
  }
}
