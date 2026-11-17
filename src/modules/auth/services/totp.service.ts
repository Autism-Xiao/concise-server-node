import { createHash, randomBytes } from 'node:crypto'

import { HttpStatus, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, IsNull } from 'typeorm'

import { BizErrorCode } from '../../../common/enums/biz-error-code.enum'
import { BizException } from '../../../common/exceptions/biz.exception'
import { buildOtpauthUri, generateTotpSecret, verifyTotpCode } from '../../../shared/totp/totp.util'
import { randomId32 } from '../../../utils/password.util'
import { UserEntity } from '../../user/entities/user.entity'
import { UserService } from '../../user/user.service'
import { UserBackupCodeEntity } from '../entities/user-backup-code.entity'

/** 备份码字符集：去掉容易看错的 0/O/1/I */
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
/** 一次生成多少条 */
const BACKUP_CODE_COUNT = 10

/** 生成形如 A3F9-K2MP 的 8 位备份码（含分隔符共 9 字符） */
function generateBackupCode(): string {
  const bytes = randomBytes(8)
  let raw = ''
  for (let index = 0; index < 8; index++) {
    raw += BACKUP_ALPHABET[bytes[index] % BACKUP_ALPHABET.length]
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`
}

/** 比对用摘要：忽略分隔符与大小写，用户手抄时带不带横线都能用 */
function digestBackupCode(code: string): string {
  return createHash('sha256').update(code.replace(/[-\s]/g, '').toUpperCase()).digest('hex')
}

/**
 * 两步验证（TOTP, RFC 6238）自助管理
 *
 * 流程：POST /v1/auth/2fa/setup 出 otpauth:// URI（前端渲染二维码）→ 用户扫码 →
 * POST /v1/auth/2fa/activate 带 6 位动态码激活（响应里一次性返回 10 条备份码）→
 * 登录开始要求 totpCode 或备份码（门禁在 AuthService.login / assertSsoTotp）。
 *
 * 密钥只存 sys_user.totp_secret（select:false），备份码只存 sha256（sys_user_backup_code），
 * 本服务是唯一写入口。错误码：2106 验证码不对 / 1001 前置状态不对。
 */
@Injectable()
export class TotpService {
  constructor(
    @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(UserBackupCodeEntity) private readonly backupRepository: Repository<UserBackupCodeEntity>,
    private readonly userService: UserService
  ) {}

  /**
   * 敏感操作（绑定/解绑 2FA）的密码二次确认
   * 会话令牌可能被盗（token 泄露、借设备），密码是 token 之外的第二道闸；
   * setup 是覆盖式写密钥，没有这道闸等于被盗会话可以直接接管账号的 2FA
   */
  private async assertPassword(userId: string, password?: string): Promise<void> {
    if (!password) {
      throw new BizException(BizErrorCode.BUSINESS_ERROR, '请输入当前密码确认操作', HttpStatus.BAD_REQUEST)
    }
    const user = await this.userService.findOneWithPassword(userId)
    if (!user || user.delFlag === 1) {
      throw new BizException(BizErrorCode.UNAUTHORIZED, '账号不存在', HttpStatus.UNAUTHORIZED)
    }
    if (!(await this.userService.verifyPassword(user, password))) {
      throw new BizException(BizErrorCode.OLD_PASSWORD_INVALID, '密码不正确，操作已拒绝', HttpStatus.BAD_REQUEST)
    }
  }

  /** 当前账号是否已开启两步验证 + 剩余可用备份码数量 */
  async getStatus(userId: string): Promise<{ enabled: boolean; remainingBackupCodes: number }> {
    const user = await this.userRepository.findOne({ where: { id: userId }, select: { id: true, totpEnabled: true } })
    const enabled = Number(user?.totpEnabled ?? 0) === 1
    return { enabled, remainingBackupCodes: enabled ? await this.countUnusedBackupCodes(userId) : 0 }
  }

  /**
   * 生成新密钥并返回 otpauth:// URI
   * 覆盖式：重复调用会换新密钥，旧二维码立即作废（防「扫了旧码激活出未知密钥」）。
   * 对已开启的账号也允许重扫（换手机场景），但旧密钥在新 activate 成功前仍然有效。
   */
  async setup(userId: string, username: string, password?: string): Promise<{ otpauthUrl: string }> {
    await this.assertPassword(userId, password)
    const secret = generateTotpSecret()
    await this.userRepository.update({ id: userId }, { totpSecret: secret })
    return { otpauthUrl: buildOtpauthUri(username, secret) }
  }

  /**
   * 验码激活：成功后登录必须带 totpCode。
   * 同时签发 10 条备份码（明文只在这里返回一次）——这是手机丢失时的唯一后路。
   */
  async activate(userId: string, code: string): Promise<{ enabled: true; backupCodes: string[] }> {
    const user = await this.userRepository.findOne({ where: { id: userId }, select: { id: true, username: true, totpSecret: true, totpEnabled: true } })
    if (!user?.totpSecret) {
      throw new BizException(BizErrorCode.BUSINESS_ERROR, '请先获取二维码，再用认证器动态码激活', HttpStatus.BAD_REQUEST)
    }
    if (!verifyTotpCode(user.totpSecret, code)) {
      throw new BizException(BizErrorCode.TOTP_INVALID, '验证码不正确或已过期，请重试', HttpStatus.BAD_REQUEST)
    }
    await this.userRepository.update({ id: userId }, { totpEnabled: 1 })
    const backupCodes = await this.issueBackupCodes(userId)
    return { enabled: true, backupCodes }
  }

  /** 验码关闭：清空密钥与备份码，登录恢复为仅密码。密码 + 动态码双确认（解绑是高危操作） */
  async deactivate(userId: string, code: string, password?: string): Promise<{ enabled: false }> {
    await this.assertPassword(userId, password)
    const user = await this.userRepository.findOne({ where: { id: userId }, select: { id: true, totpSecret: true, totpEnabled: true } })
    if (!user || Number(user.totpEnabled ?? 0) !== 1) {
      throw new BizException(BizErrorCode.BUSINESS_ERROR, '该账号未开启两步验证', HttpStatus.BAD_REQUEST)
    }
    if (!verifyTotpCode(user.totpSecret ?? '', code)) {
      throw new BizException(BizErrorCode.TOTP_INVALID, '验证码不正确或已过期，请重试', HttpStatus.BAD_REQUEST)
    }
    await this.userRepository.update({ id: userId }, { totpEnabled: 0, totpSecret: null })
    await this.backupRepository.delete({ userId })
    return { enabled: false }
  }

  /**
   * 重新生成备份码（旧码全部作废）
   * 需要当前 TOTP 动态码，防止「借到已登录设备的人无限续命」。
   */
  async regenerateBackupCodes(userId: string, code: string): Promise<{ backupCodes: string[] }> {
    const user = await this.userRepository.findOne({ where: { id: userId }, select: { id: true, totpSecret: true, totpEnabled: true } })
    if (!user || Number(user.totpEnabled ?? 0) !== 1) {
      throw new BizException(BizErrorCode.BUSINESS_ERROR, '请先开启两步验证', HttpStatus.BAD_REQUEST)
    }
    if (!verifyTotpCode(user.totpSecret ?? '', code)) {
      throw new BizException(BizErrorCode.TOTP_INVALID, '验证码不正确或已过期，请重试', HttpStatus.BAD_REQUEST)
    }
    return { backupCodes: await this.issueBackupCodes(userId) }
  }

  /** 剩余可用备份码数量（前端提示「还剩 3 条，建议重新生成」） */
  async countUnusedBackupCodes(userId: string): Promise<number> {
    return this.backupRepository.count({ where: { userId, usedAt: IsNull() } })
  }

  /**
   * 消费一条备份码：命中未使用的则标记已用并返回 true。
   * 登录门禁在 TOTP 校验失败后调用它——所以这里必须严格一次性。
   */
  async consumeBackupCode(userId: string, code: string): Promise<boolean> {
    if (!code) return false
    const row = await this.backupRepository.findOne({ where: { userId, codeHash: digestBackupCode(code) } })
    if (!row || row.usedAt) return false
    await this.backupRepository.update(row.id, { usedAt: new Date() })
    return true
  }

  /** 生成并落库一批新备份码（先删旧的全部：重新生成即作废旧码） */
  private async issueBackupCodes(userId: string): Promise<string[]> {
    await this.backupRepository.delete({ userId })
    const plainCodes: string[] = []
    const rows: UserBackupCodeEntity[] = []
    for (let index = 0; index < BACKUP_CODE_COUNT; index++) {
      const plain = generateBackupCode()
      plainCodes.push(plain)
      rows.push(Object.assign(new UserBackupCodeEntity(), { id: randomId32(), userId, codeHash: digestBackupCode(plain) }))
    }
    await this.backupRepository.save(rows)
    return plainCodes
  }
}
