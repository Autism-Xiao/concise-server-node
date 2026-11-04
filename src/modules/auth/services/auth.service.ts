import { Injectable, UnauthorizedException, BadRequestException, HttpException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import type { StringValue } from 'ms'

import { UserService, USER_STATUS } from '../../user/user.service'
import { LogService } from '../../system/log/log.service'
import { CaptchaService } from './captcha.service'
import { LoginDto } from '../dto/login.dto'

export interface JwtPayload {
  id: string
  username: string
}

export interface LoginResult {
  accessToken: string
  refreshToken: string
  expiresIn: number
  userInfo: Record<string, unknown>
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly logService: LogService,
    private readonly captchaService: CaptchaService
  ) {}

  /** 登录：验证码校验（可开关）→ 账号密码校验 → 签发双令牌；成败都记入登录日志 */
  async login(dto: LoginDto, meta: { ip: string; userAgent?: string }): Promise<LoginResult> {
    try {
      // 验证码开关：CAPTCHA_ENABLED=true 时强制校验（防爆破）
      if (this.configService.get<string>('CAPTCHA_ENABLED') === 'true') {
        if (!dto.captchaId || !dto.captchaCode) {
          throw new BadRequestException('请输入验证码')
        }
        if (!(await this.captchaService.verify(dto.captchaId, dto.captchaCode))) {
          throw new BadRequestException('验证码错误或已过期')
        }
      }

      const user = await this.userService.findByUsername(dto.username)
      if (!user) {
        throw new UnauthorizedException('用户名或密码错误')
      }

      // JeecgBoot 兼容校验：PBEWithMD5AndDES(username, password, salt) 与库中 16 位 hex 比对
      if (!this.userService.verifyPassword(user, dto.password)) {
        throw new UnauthorizedException('用户名或密码错误')
      }

      if (user.status !== USER_STATUS.NORMAL) {
        throw new UnauthorizedException('账号已被冻结，请联系管理员')
      }

      await this.logService.recordLogin({ username: dto.username, status: 1, message: '登录成功', ip: meta.ip, userAgent: meta.userAgent })
      return this.issueTokens(user)
    } catch (error) {
      const message = error instanceof HttpException ? error.message : '登录异常'
      await this.logService.recordLogin({ username: dto.username, status: 0, message, ip: meta.ip, userAgent: meta.userAgent })
      throw error
    }
  }

  /** 用 refreshToken 换新令牌对 */
  async refreshToken(refreshToken: string): Promise<LoginResult> {
    let payload: JwtPayload
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET')
      })
    } catch {
      throw new UnauthorizedException('refreshToken 无效或已过期')
    }

    const user = await this.userService.findOne(String(payload.id))
    return this.issueTokens(user)
  }

  /** 签发 accessToken + refreshToken */
  private async issueTokens(user: import('../../user/entities/user.entity').UserEntity): Promise<LoginResult> {
    const payload: JwtPayload = { id: user.id, username: user.username }
    const secret = this.configService.get<string>('JWT_SECRET')
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET')
    const expiresIn = (this.configService.get<string>('JWT_EXPIRES_IN') || '2h') as StringValue
    const refreshExpiresIn = (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d') as StringValue

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, { secret, expiresIn }),
      this.jwtService.signAsync(payload, { secret: refreshSecret, expiresIn: refreshExpiresIn })
    ])

    return {
      accessToken,
      refreshToken,
      expiresIn: this.parseExpiresIn(expiresIn),
      userInfo: this.userService.stripPassword(user)
    }
  }

  /** 把 "2h"/"7d" 等过期时间换算成秒，方便前端定时刷新 */
  private parseExpiresIn(value: string): number {
    const match = /^(\d+)([smhd])$/.exec(value)
    if (!match) return 7200
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }
    return Number(match[1]) * multipliers[match[2]]
  }
}
