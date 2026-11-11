import { HttpStatus, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { BizErrorCode } from '../../../common/enums/biz-error-code.enum'
import { BizException } from '../../../common/exceptions/biz.exception'
import { buildOtpauthUri, generateTotpSecret, verifyTotpCode } from '../../../shared/totp/totp.util'
import { UserEntity } from '../../user/entities/user.entity'

/**
 * 两步验证（TOTP, RFC 6238）自助管理
 *
 * 流程：POST /v1/auth/2fa/setup 出 otpauth:// URI（前端渲染二维码）→ 用户扫码 →
 * POST /v1/auth/2fa/activate 带 6 位动态码激活 → 登录开始要求 totpCode（登录门禁在
 * AuthService.login 的「两步验证门禁」段）；关闭走 2fa/deactivate，同样要验码。
 *
 * 密钥只存 sys_user.totp_secret（select:false），本服务是唯一写入口；
 * 错误码：2106 验证码不对 / 1005 前置状态不对（未 setup 就激活、未开启就关闭）。
 */
@Injectable()
export class TotpService {
  constructor(@InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>) {}

  /** 当前账号是否已开启两步验证 */
  async getStatus(userId: string): Promise<{ enabled: boolean }> {
    const user = await this.userRepository.findOne({ where: { id: userId }, select: { id: true, totpEnabled: true } })
    return { enabled: Number(user?.totpEnabled ?? 0) === 1 }
  }

  /**
   * 生成新密钥并返回 otpauth:// URI
   * 覆盖式：重复调用会换新密钥，旧二维码立即作废（防「扫了旧码激活出未知密钥」）。
   * 对已开启的账号也允许重扫（换手机场景），但旧密钥在新 activate 成功前仍然有效。
   */
  async setup(userId: string, username: string): Promise<{ otpauthUrl: string }> {
    const secret = generateTotpSecret()
    await this.userRepository.update({ id: userId }, { totpSecret: secret })
    return { otpauthUrl: buildOtpauthUri(username, secret) }
  }

  /** 验码激活：成功后登录必须带 totpCode */
  async activate(userId: string, code: string): Promise<{ enabled: true }> {
    const user = await this.userRepository.findOne({ where: { id: userId }, select: { id: true, username: true, totpSecret: true, totpEnabled: true } })
    if (!user?.totpSecret) {
      throw new BizException(BizErrorCode.BUSINESS_ERROR, '请先获取二维码，再用认证器动态码激活', HttpStatus.BAD_REQUEST)
    }
    if (!verifyTotpCode(user.totpSecret, code)) {
      throw new BizException(BizErrorCode.TOTP_INVALID, '验证码不正确或已过期，请重试', HttpStatus.BAD_REQUEST)
    }
    await this.userRepository.update({ id: userId }, { totpEnabled: 1 })
    return { enabled: true }
  }

  /** 验码关闭：清空密钥，登录恢复为仅密码 */
  async deactivate(userId: string, code: string): Promise<{ enabled: false }> {
    const user = await this.userRepository.findOne({ where: { id: userId }, select: { id: true, totpSecret: true, totpEnabled: true } })
    if (!user || Number(user.totpEnabled ?? 0) !== 1) {
      throw new BizException(BizErrorCode.BUSINESS_ERROR, '该账号未开启两步验证', HttpStatus.BAD_REQUEST)
    }
    if (!verifyTotpCode(user.totpSecret ?? '', code)) {
      throw new BizException(BizErrorCode.TOTP_INVALID, '验证码不正确或已过期，请重试', HttpStatus.BAD_REQUEST)
    }
    await this.userRepository.update({ id: userId }, { totpEnabled: 0, totpSecret: null })
    return { enabled: false }
  }
}
