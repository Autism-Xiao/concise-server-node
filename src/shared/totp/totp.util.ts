import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * TOTP 两步验证（RFC 6238）：HMAC-SHA1 / 30 秒步长 / 6 位数字
 *
 * 纯 node:crypto 实现，不引第三方依赖（算法只有几十行，依赖反而多供应链面）。
 * 配套：密钥存 sys_user.totp_secret（select:false，任何列表/详情接口不下发），
 * 登录门禁在 AuthService.login（两步验证门禁段），管理接口在 TotpService。
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
/** 步长（秒）：Google Authenticator 等主流认证器默认 30s */
const PERIOD_SECONDS = 30

/** 生成 20 字节随机密钥并编码为 base32（RFC 4648 无填充） */
export function generateTotpSecret(): string {
  const buf = randomBytes(20)
  let bits = ''
  for (const byte of buf) {
    bits += byte.toString(2).padStart(8, '0')
  }
  let out = ''
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[Number.parseInt(bits.slice(i, i + 5), 2)]
  }
  return out
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = ''
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx >= 0) {
      bits += idx.toString(2).padStart(5, '0')
    }
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

/** 指定计数器（时间步）的 6 位动态码 */
export function totpCodeAt(secret: string, counter: number): string {
  const key = base32Decode(secret)
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter % 2 ** 32, 4)
  const digest = createHmac('sha1', key).update(buf).digest()
  // 动态截断（RFC 4226 5.3）：最后一字节低 4 位做偏移，取 4 字节去掉最高位
  const offset = digest[digest.length - 1] & 0x0f
  const bin = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff)
  return String(bin % 1_000_000).padStart(6, '0')
}

/** 校验 6 位动态码；允许 ±window 个步长的时钟漂移（默认 ±1 = 前后各 30 秒） */
export function verifyTotpCode(secret: string, code: string, window = 1): boolean {
  if (!secret || !/^\d{6}$/.test(code)) {
    return false
  }
  const counter = Math.floor(Date.now() / 1000 / PERIOD_SECONDS)
  for (let drift = -window; drift <= window; drift++) {
    const expected = Buffer.from(totpCodeAt(secret, counter + drift))
    const given = Buffer.from(code)
    // 逐窗常量时间比较，避免 timing 侧信道
    if (expected.length === given.length && timingSafeEqual(expected, given)) {
      return true
    }
  }
  return false
}

/** 生成 otpauth:// URI：Google Authenticator / 1Password / 微信小程序认证器扫码即识别 */
export function buildOtpauthUri(username: string, secret: string, issuer = 'ConciseAdmin'): string {
  const label = encodeURIComponent(`${issuer}:${username}`)
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: String(PERIOD_SECONDS) })
  return `otpauth://totp/${label}?${params.toString()}`
}
