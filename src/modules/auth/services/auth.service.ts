import { Injectable, Inject, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { randomUUID } from 'node:crypto'

import { captchaConfig, jwtConfig, type CaptchaConfig, type JwtConfig } from '../../../config'
import { hasSuperRole } from '../../../utils/super-role.util'
import { isArgon2Hash } from '../../../utils/password.util'
import { BizErrorCode } from '../../../common/enums/biz-error-code.enum'
import { BizException } from '../../../common/exceptions/biz.exception'
import { RateLimitService } from '../../../shared/rate-limit/rate-limit.service'
import { loginFailKeyOf } from '../../../shared/rate-limit/login-fail.util'
import { UserService, USER_STATUS } from '../../user/user.service'
import { LogService } from '../../system/log/log.service'
import { MenuService, buildMenuTree, type MenuTreeItem } from '../../menu/menu.service'
import { OnlineService } from '../../ops/online/online.service'
import type { MenuEntity } from '../../menu/entities/menu.entity'
import { CaptchaService } from './captcha.service'
import { LoginDto } from '../dto/login.dto'

/** 同一账号连续密码错误次数上限（达到后锁定） */
export const LOGIN_MAX_FAILS = 5
/** 锁定时长（秒），同时也是失败计数的滑动窗口 */
export const LOGIN_LOCK_SECONDS = 15 * 60
/** refreshToken 并发刷新宽限期：超过这个间隔还在用「已换掉的」令牌，判定为泄露后被重放 */
const REFRESH_REUSE_GRACE_MS = 10 * 1000

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
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    @Inject(jwtConfig.KEY) private readonly jwt: JwtConfig,
    @Inject(captchaConfig.KEY) private readonly captcha: CaptchaConfig,
    private readonly logService: LogService,
    private readonly captchaService: CaptchaService,
    private readonly menuService: MenuService,
    private readonly onlineService: OnlineService,
    private readonly rateLimitService: RateLimitService
  ) {}

  /**
   * 登录：验证码校验（可开关）→ 失败锁定检查 → 账号密码校验 → 签发双令牌；成败都记入登录日志
   *
   * 为什么还要自己做失败锁定：滑块验证码是开关式的，CAPTCHA_ENABLED=false 或 Redis 故障时等于裸奔，
   * 这里按账号累计密码错误次数（Redis 共享，多实例一致），5 次锁 15 分钟，避免无限撞库。
   */
  async login(dto: LoginDto, meta: { ip: string; userAgent?: string }): Promise<LoginResult> {
    const failKey = this.loginFailKey(dto.username)
    try {
      // 验证码开关：captcha.enabled=true 时强制校验滑块验证票据（防爆破）
      if (this.captcha.enabled) {
        await this.captchaService.assertTicket(dto.captchaTicket)
      }

      await this.assertNotLocked(failKey)

      const user = await this.userService.findByUsername(dto.username)
      if (!user) {
        throw new BizException(BizErrorCode.LOGIN_FAILED, '用户名或密码错误', HttpStatus.UNAUTHORIZED)
      }

      // 密码校验：新数据走 argon2id，历史数据走 JeecgBoot PBEWithMD5AndDES（见 UserService.verifyPassword）
      if (!(await this.userService.verifyPassword(user, dto.password))) {
        throw new BizException(BizErrorCode.LOGIN_FAILED, '用户名或密码错误', HttpStatus.UNAUTHORIZED)
      }

      if (user.status !== USER_STATUS.NORMAL) {
        throw new BizException(BizErrorCode.ACCOUNT_DISABLED, '账号已被冻结，请联系管理员', HttpStatus.FORBIDDEN)
      }

      // 透明迁移：老算法密码登录成功后立即改写为 argon2id，不需要停机刷库
      // 失败不影响本次登录（用户已经验证通过），下次登录会再试一次
      if (!isArgon2Hash(user.password)) {
        await this.userService.upgradePasswordHash(user.id, dto.password)
      }

      // 登录成功即清零失败计数，避免「白天输错两次、晚上再错三次」被累计误锁
      await this.rateLimitService.reset(failKey)

      // status 为 jeecg 语义（sys_log）：0 正常（成功）/ 1 异常（失败）
      await this.logService.recordLogin({ username: dto.username, status: 0, message: '登录成功', ip: meta.ip, userAgent: meta.userAgent })
      return this.issueTokens(user)
    } catch (error) {
      await this.recordLoginFailure(failKey, dto.username, error)
      const message = error instanceof HttpException ? error.message : '登录异常'
      await this.logService.recordLogin({ username: dto.username, status: 1, message, ip: meta.ip, userAgent: meta.userAgent })
      throw error
    }
  }

  /** 当前登录用户信息（脱敏，不含 password / salt）：供 GET /v1/auth/profile 使用 */
  getProfile(user: import('../../user/entities/user.entity').UserEntity) {
    return this.userService.stripPassword(user)
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

    // 权限码：菜单节点（决定能否进页面/调列表接口）与按钮节点（决定能否增删改）都算；
    // 只用 allowedIds 判定，祖先补齐出来的目录不授予权限码
    const permissions = [...new Set(allMenus.filter(menu => allowedIds.has(menu.id)).flatMap(menu => (menu.perms ? [menu.perms] : [])))]

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

  /**
   * 用 refreshToken 换新令牌对（轮换：一个 refreshToken 只能用一次）
   *
   * 重放检测：正常客户端拿到新令牌后就不会再提交旧的。若旧的（已拉黑）在宽限期之后
   * 又被使用，说明它已被第三方拿到 → 判定为泄露，踢掉该账号全部会话，让真用户重新登录。
   */
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
    const revocation = await this.onlineService.getRevocation(refreshToken)
    if (revocation.revoked) {
      if (revocation.at > 0 && Date.now() - revocation.at > REFRESH_REUSE_GRACE_MS) {
        await this.onlineService.revokeUser(String(payload.id), this.parseExpiresIn(this.jwt.refreshExpiresIn))
        this.logger.warn(`检测到 refreshToken 重放（用户 ${payload.username}），已强制下线该账号全部会话`)
      }
      throw new BizException(BizErrorCode.UNAUTHORIZED, '登录状态已失效，请重新登录', HttpStatus.UNAUTHORIZED)
    }

    const user = await this.userService.findOneDetail(String(payload.id))
    const result = await this.issueTokens(user)
    // 轮换：旧 refreshToken 立即作废（TTL 到其自然过期，不占用长期空间）
    await this.onlineService.markRevoked(refreshToken, this.remainingTtl(refreshToken, this.parseExpiresIn(this.jwt.refreshExpiresIn)))
    return result
  }

  /** 失败计数 key：账号维度（大小写不敏感），与 IP 限流互补（实现在 shared/rate-limit/login-fail.util） */
  private loginFailKey(username: string): string {
    return loginFailKeyOf(username)
  }

  /**
   * 管理员解锁账号：清零登录失败计数
   * 幂等：未锁定的账号解锁也返回成功（前端不必先查状态）
   */
  async unlockAccount(username: string): Promise<{ unlocked: true }> {
    await this.rateLimitService.reset(loginFailKeyOf(username))
    return { unlocked: true }
  }

  /** 查询账号锁定状态：供前端在解锁前展示（是否锁定 + 剩余秒数） */
  async getLockState(username: string): Promise<{ locked: boolean; remainingSeconds: number }> {
    const hit = await this.rateLimitService.get(loginFailKeyOf(username))
    const remainingSeconds = hit.count >= LOGIN_MAX_FAILS ? Math.max(Math.ceil((hit.resetAt - Date.now()) / 1000), 0) : 0
    return { locked: remainingSeconds > 0, remainingSeconds }
  }

  /**
   * 自助修改密码：验旧密码 → 写新密码 → 其他端全部下线（保留当前会话）
   * 为什么踢下线：密码改了意味着「旧凭证可能已泄露」，别的登录态不能续命
   */
  async changePassword(userId: string, dto: { oldPassword: string; newPassword: string }, currentToken: string): Promise<{ changed: true }> {
    const user = await this.userService.findOneWithPassword(userId)
    if (!user || user.delFlag === 1) {
      throw new BizException(BizErrorCode.UNAUTHORIZED, '账号不存在', HttpStatus.UNAUTHORIZED)
    }
    if (!(await this.userService.verifyPassword(user, dto.oldPassword))) {
      throw new BizException(BizErrorCode.LOGIN_FAILED, '原密码不正确', HttpStatus.BAD_REQUEST)
    }
    if (dto.oldPassword === dto.newPassword) {
      throw new BizException(BizErrorCode.BUSINESS_ERROR, '新密码不能与原密码相同', HttpStatus.BAD_REQUEST)
    }
    await this.userService.updatePasswordOnly(userId, dto.newPassword)
    await this.onlineService.kickUser(userId, { keepToken: currentToken })
    return { changed: true }
  }

  /** 命中锁定则直接拒绝，并告知还要等多久 */
  private async assertNotLocked(failKey: string): Promise<void> {
    const hit = await this.rateLimitService.get(failKey)
    if (hit.count < LOGIN_MAX_FAILS || hit.resetAt <= Date.now()) {
      return
    }
    const minutes = Math.max(Math.ceil((hit.resetAt - Date.now()) / 60000), 1)
    throw new BizException(BizErrorCode.ACCOUNT_LOCKED, `密码错误次数过多，账号已临时锁定，请 ${minutes} 分钟后再试`, HttpStatus.TOO_MANY_REQUESTS)
  }

  /** 只有「账号密码错误」才计数：验证码错误、账号冻结、已锁定都不算密码尝试 */
  private async recordLoginFailure(failKey: string, username: string, error: unknown): Promise<void> {
    const isPasswordFailure = error instanceof BizException && error.getBizCode() === BizErrorCode.LOGIN_FAILED
    if (!isPasswordFailure) {
      return
    }
    const hit = await this.rateLimitService.increment(failKey, LOGIN_LOCK_SECONDS)
    if (hit.count === LOGIN_MAX_FAILS) {
      this.logger.warn(`账号 ${username} 连续 ${hit.count} 次密码错误，已锁定 ${Math.round(LOGIN_LOCK_SECONDS / 60)} 分钟`)
    }
  }

  /** 令牌剩余有效期（秒），取令牌自身 exp；解析失败用兜底值 */
  private remainingTtl(token: string, fallbackSeconds: number): number {
    try {
      const exp = (this.jwtService.decode(token) as { exp?: number } | null)?.exp
      const remaining = (exp ?? 0) - Math.floor(Date.now() / 1000)
      return remaining > 0 ? remaining : fallbackSeconds
    } catch {
      return fallbackSeconds
    }
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
    const base = { id: user.id, username: user.username }
    const { secret, refreshSecret, expiresIn, refreshExpiresIn } = this.jwt

    // jti 必加：JWT 的 payload 只有 id/username/iat（秒级），同一秒内签发的两个令牌完全相同。
    // 轮换时「新 refreshToken === 旧 refreshToken」会导致刚签发就被自己拉黑，客户端直接掉线。
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync({ ...base, jti: randomUUID() }, { secret, expiresIn }),
      this.jwtService.signAsync({ ...base, jti: randomUUID() }, { secret: refreshSecret, expiresIn: refreshExpiresIn })
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
