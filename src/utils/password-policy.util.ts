import { HttpStatus } from '@nestjs/common'

import { BizErrorCode } from '../common/enums/biz-error-code.enum'
import { BizException } from '../common/exceptions/biz.exception'

/**
 * 密码强度校验（策略值来自 sys_config，见 SystemConfigService.getPasswordPolicy）
 *
 * 只在「给人设置密码」的入口调用（新建用户、管理员重置、用户自助改密），
 * 底层 updatePasswordOnly 不校验，避免重复报错。
 */

export interface PasswordPolicyInput {
  /** 最小长度 */
  minLength: number
  /** 是否要求「大写/小写/数字/符号」至少三类 */
  requireComplexity: boolean
}

/**
 * 内置弱口令：只放最常见的，不追求全覆盖（真要挡撞库得接 HIBP 之类的离线库）。
 * 比较时统一转小写。
 */
const WEAK_PASSWORDS = new Set([
  'password',
  'password1',
  'passw0rd',
  '12345678',
  '123456789',
  '1234567890',
  '87654321',
  '11111111',
  '88888888',
  'abc12345',
  'abcd1234',
  'qwertyui',
  'qwerty123',
  'admin123',
  'admin888',
  'adminadmin',
  'root1234',
  'iloveyou',
  'welcome1',
  'letmein1'
])

/** 单个字符占比过半（aaaaaaaa / aaaaaaaA1 / 1111112）也算弱 —— 只看「全同」会漏掉这类 */
function hasDominantChar(password: string): boolean {
  const counts = new Map<string, number>()
  for (const ch of password) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1)
  }
  const max = Math.max(0, ...counts.values())
  return max > password.length / 2
}

/** 键盘顺序序列（12345678 / abcdefgh / qwertyui） */
function isSequential(password: string): boolean {
  const lower = password.toLowerCase()
  const sequences = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']
  return sequences.some(seq => {
    for (let start = 0; start + lower.length <= seq.length; start++) {
      if (seq.slice(start, start + lower.length) === lower) return true
    }
    return false
  })
}

/**
 * 校验密码是否满足策略；不满足直接抛 1001（前端展示 message 即可）。
 *
 * @param password 明文密码
 * @param policy   策略（长度 + 复杂度开关）
 * @param username 目标用户名（可选）：密码里不能包含用户名，挡掉「zhangsan / zhangsan123」
 */
export function assertPasswordStrength(password: string, policy: PasswordPolicyInput, username?: string): void {
  const value = password ?? ''
  const minLength = Math.max(policy.minLength || 8, 1)
  if (value.length < minLength) {
    throw new BizException(BizErrorCode.PARAM_INVALID, `密码长度不能少于 ${minLength} 位`, HttpStatus.BAD_REQUEST)
  }
  // 上限兜底：Argon2 对超长输入虽安全，但没必要允许 1MB 的「密码」打爆内存
  if (value.length > 128) {
    throw new BizException(BizErrorCode.PARAM_INVALID, '密码长度不能超过 128 位', HttpStatus.BAD_REQUEST)
  }
  if (/\s/.test(value)) {
    throw new BizException(BizErrorCode.PARAM_INVALID, '密码不能包含空格', HttpStatus.BAD_REQUEST)
  }
  if (policy.requireComplexity) {
    const kinds = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(rule => rule.test(value)).length
    if (kinds < 3) {
      throw new BizException(BizErrorCode.PARAM_INVALID, '密码需包含大写字母、小写字母、数字、符号中的至少三类', HttpStatus.BAD_REQUEST)
    }
  }
  const lower = value.toLowerCase()
  if (WEAK_PASSWORDS.has(lower)) {
    throw new BizException(BizErrorCode.PARAM_INVALID, '密码过于常见，请更换', HttpStatus.BAD_REQUEST)
  }
  if (hasDominantChar(value) || isSequential(value)) {
    throw new BizException(BizErrorCode.PARAM_INVALID, '密码不能是重复字符或连续序列', HttpStatus.BAD_REQUEST)
  }
  if (username && username.trim().length >= 3 && lower.includes(username.trim().toLowerCase())) {
    throw new BizException(BizErrorCode.PARAM_INVALID, '密码不能包含用户名', HttpStatus.BAD_REQUEST)
  }
}
