import { randomInt } from 'node:crypto'

/** 去掉易混淆字符（0/O/1/l/I）的安全字母表 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz'

/**
 * 生成人类可读的随机口令（重置密码等一次性下发场景）
 * 为什么不用 randomBytes hex：hex 里的 0/1 和字母 O/l 在口头转述、手抄时极易出错
 */
export function randomToken(length = 12): string {
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[randomInt(ALPHABET.length)]
  }
  return out
}
