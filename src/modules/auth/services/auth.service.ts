import { Injectable, Inject, HttpException, HttpStatus } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'

import { captchaConfig, jwtConfig, type CaptchaConfig, type JwtConfig } from '../../../config'
import { hasSuperRole } from '../../../utils/super-role.util'
import { BizErrorCode } from '../../../common/enums/biz-error-code.enum'
import { BizException } from '../../../common/exceptions/biz.exception'
import { UserService, USER_STATUS } from '../../user/user.service'
import { LogService } from '../../system/log/log.service'
import { MenuService, buildMenuTree, type MenuTreeItem } from '../../menu/menu.service'
import { OnlineService } from '../../ops/online/online.service'
import type { MenuEntity } from '../../menu/entities/menu.entity'
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

/** 登录后权限汇总（对齐 JeecgBoot GetUserPermissionByToken） */
export interface PermissionResult {
  /** 角色 code 数组，如 ['admin'] */
  roles: string[]
  /** 按钮权限编码汇总；超级管理员返回 ['*'] */
  permissions: string[]
  /** 按角色过滤后的菜单树（不含按钮节点，保留祖先层级），侧边栏/动态路由数据源 */
  menus: MenuTreeItem[]
}

/** 拥有全部权限的超级角色 code（统一由 utils/super-role.util 判定，勿在各处另写） */

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    @Inject(jwtConfig.KEY) private readonly jwt: JwtConfig,
    @Inject(captchaConfig.KEY) private readonly captcha: CaptchaConfig,
    private readonly logService: LogService,
    private readonly captchaService: CaptchaService,
    private readonly menuService: MenuService,
    private readonly onlineService: OnlineService
  ) {}

  /** 登录：验证码校验（可开关）→ 账号密码校验 → 签发双令牌；成败都记入登录日志 */
  async login(dto: LoginDto, meta: { ip: string; userAgent?: string }): Promise<LoginResult> {
    try {
      // 验证码开关：captcha.enabled=true 时强制校验（防爆破）
      if (this.captcha.enabled) {
        await this.captchaService.assertValid(dto.captchaId, dto.captchaCode)
      }

      const user = await this.userService.findByUsername(dto.username)
      if (!user) {
        throw new BizException(BizErrorCode.LOGIN_FAILED, '用户名或密码错误', HttpStatus.UNAUTHORIZED)
      }

      // JeecgBoot 兼容校验：PBEWithMD5AndDES(username, password, salt) 与库中 16 位 hex 比对
      if (!this.userService.verifyPassword(user, dto.password)) {
        throw new BizException(BizErrorCode.LOGIN_FAILED, '用户名或密码错误', HttpStatus.UNAUTHORIZED)
      }

      if (user.status !== USER_STATUS.NORMAL) {
        throw new BizException(BizErrorCode.ACCOUNT_DISABLED, '账号已被冻结，请联系管理员', HttpStatus.FORBIDDEN)
      }

      // status 为 jeecg 语义（sys_log）：0 正常（成功）/ 1 异常（失败）
      await this.logService.recordLogin({ username: dto.username, status: 0, message: '登录成功', ip: meta.ip, userAgent: meta.userAgent })
      return this.issueTokens(user)
    } catch (error) {
      const message = error instanceof HttpException ? error.message : '登录异常'
      await this.logService.recordLogin({ username: dto.username, status: 1, message, ip: meta.ip, userAgent: meta.userAgent })
      throw error
    }
  }

  /** 登录后权限汇总：角色 code、按钮权限、按角色过滤的菜单树（前端侧边栏与按钮级控制的数据源） */
  async getPermissions(userId: string): Promise<PermissionResult> {
    const user = await this.userService.findOneWithRolePermissions(userId)
    if (!user) {
      throw new BizException(BizErrorCode.UNAUTHORIZED, '账号不存在或已被冻结', HttpStatus.UNAUTHORIZED)
    }

    const roles = (user.roles ?? []).map(role => role.roleCode).filter(Boolean)
    // 超管：内置规则全权（不读 sys_role_permission），与 PermsGuard / RolesGuard 共用同一判定
    const isAdmin = hasSuperRole(user.roles)
    // 有效菜单（未删除、状态有效），按 sort_no 升序
    const allMenus = (await this.menuService.listAll()).filter(menu => menu.status === '1')

    if (isAdmin) {
      return { roles, permissions: ['*'], menus: buildMenuTree(allMenus, null) }
    }

    // 非超管：汇总各角色授权的菜单/按钮 id
    const allowedIds = new Set<string>()
    for (const role of user.roles ?? []) {
      for (const perm of role.permissions ?? []) {
        allowedIds.add(perm.id)
      }
    }

    // 按钮权限编码（menuType=2 且配置了 perms）
    const permissions = [...new Set(allMenus.filter(menu => menu.menuType === 2 && allowedIds.has(menu.id) && menu.perms).map(menu => menu.perms as string))]

    // 菜单树：授权节点 + 补齐祖先链（子菜单可见则父级目录必须可见），按钮节点不进树
    const keepIds = new Set<string>()
    for (const menu of allMenus) {
      if (menu.menuType === 2 || !allowedIds.has(menu.id)) continue
      let current: MenuEntity | undefined = menu
      while (current) {
        keepIds.add(current.id)
        current = current.parentId ? allMenus.find(m => m.id === current?.parentId) : undefined
      }
    }
    const menus = buildMenuTree(
      allMenus.filter(menu => menu.menuType !== 2 && keepIds.has(menu.id)),
      null
    )

    return { roles, permissions, menus }
  }

  /** 用 refreshToken 换新令牌对 */
  async refreshToken(refreshToken: string): Promise<LoginResult> {
    let payload: JwtPayload
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.jwt.refreshSecret
      })
    } catch {
      throw new BizException(BizErrorCode.UNAUTHORIZED, 'refreshToken 无效或已过期', HttpStatus.UNAUTHORIZED)
    }

    // 与登录返回保持同构：带角色与部门（depts / dept / deptId）
    // 登出时 refreshToken 已拉黑，防止退出登录后继续刷新续命
    if (await this.onlineService.isRevoked(refreshToken)) {
      throw new BizException(BizErrorCode.UNAUTHORIZED, '登录状态已失效，请重新登录', HttpStatus.UNAUTHORIZED)
    }
    const user = await this.userService.findOneDetail(String(payload.id))
    return this.issueTokens(user)
  }

  /**
   * 退出登录：accessToken 与 refreshToken（可选）拉黑并删除在线会话
   * - TTL 取令牌自身的剩余有效期，拉黑到自然过期为止
   * - 幂等：重复登出 / 令牌已过期均不报错
   */
  async logout(token: string, refreshToken?: string): Promise<{ loggedOut: true }> {
    const ttlOf = (value: string): number => {
      try {
        const exp = (this.jwtService.decode(value) as { exp?: number } | null)?.exp
        const remaining = (exp ?? 0) - Math.floor(Date.now() / 1000)
        return remaining > 0 ? remaining : 60
      } catch {
        return 60
      }
    }
    await this.onlineService.logout(token, ttlOf(token), refreshToken, refreshToken ? ttlOf(refreshToken) : undefined)
    return { loggedOut: true }
  }

  /** 签发 accessToken + refreshToken */
  private async issueTokens(user: import('../../user/entities/user.entity').UserEntity): Promise<LoginResult> {
    const payload: JwtPayload = { id: user.id, username: user.username }
    const { secret, refreshSecret, expiresIn, refreshExpiresIn } = this.jwt

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
