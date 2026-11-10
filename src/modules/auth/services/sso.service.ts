import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { DataSource, In } from 'typeorm'

import { jwtConfig, oidcConfig, type JwtConfig, type OidcConfig } from '../../../config'
import { BizErrorCode } from '../../../common/enums/biz-error-code.enum'
import { BizException } from '../../../common/exceptions/biz.exception'
import { RoleEntity } from '../../role/entities/role.entity'
import { UserEntity } from '../../user/entities/user.entity'
import { UserService, USER_STATUS } from '../../user/user.service'

/** /.well-known/openid-configuration 里用得到的三个端点 */
interface OidcDiscovery {
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
}

/** userinfo 返回的子集（其余字段原样透传给需要的地方） */
interface OidcUserInfo {
  sub?: string
  preferred_username?: string
  name?: string
  email?: string
  [key: string]: unknown
}

/** state 的有效时长：从跳转 IdP 到回调的最大间隔，10 分钟足够慢网络用 */
const STATE_TTL_MS = 10 * 60 * 1000
/** 一次性换 code 的有效时长：回调成功到前端 exchange 之间，2 分钟足够 */
const SSO_CODE_TTL_MS = 2 * 60 * 1000
/** discovery 缓存 1 小时（IdP 端点极少变动） */
const DISCOVERY_TTL_MS = 60 * 60 * 1000

/**
 * OIDC / SSO 单点登录服务
 *
 * 流程（标准授权码）：
 *  1. GET /v1/auth/sso/authorize      → 302 到 IdP 授权页（state 用 HMAC 签名防 CSRF，无状态可横向扩展）
 *  2. IdP 回调 GET /v1/auth/sso/callback → 验 state → code 换 token → 拉 userinfo → 匹配/自动建本地账号
 *     → 签发一次性 code → 302 回前端 frontendRedirect?sso_code=xxx
 *  3. 前端 POST /v1/auth/sso/exchange { code } → 换取本项目 accessToken/refreshToken（code 一次性，2 分钟有效）
 *
 * 多实例注意：一次性 code 存进程内存 Map，多副本部署时需换 Redis（与验证码同样的限制）。
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name)
  private readonly oidc: OidcConfig
  private readonly hmacSecret: string

  private discoveryCache?: { data: OidcDiscovery; expiresAt: number }
  /** 一次性登录 code → 用户 id（单实例内存版，见类注释） */
  private readonly ssoCodes = new Map<string, { userId: string; expiresAt: number }>()

  constructor(
    @Inject(oidcConfig.KEY) oidc: OidcConfig,
    @Inject(jwtConfig.KEY) jwt: JwtConfig,
    private readonly dataSource: DataSource,
    private readonly userService: UserService
  ) {
    this.oidc = oidc
    this.hmacSecret = jwt.refreshSecret
    if (oidc.enabled && (!oidc.issuer || !oidc.clientId || !oidc.clientSecret)) {
      // 配置错误必须在第一时间暴露：enable 了却缺三件套，等于上线后第一个登录的人报神秘 500
      throw new Error('OIDC_ENABLED=true 时 OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET 均为必填，请检查 .env')
    }
  }

  get enabled(): boolean {
    return this.oidc.enabled
  }

  /** 拉取（带缓存）IdP 的 OpenID 发现文档 */
  private async discover(): Promise<OidcDiscovery> {
    const cached = this.discoveryCache
    if (cached && cached.expiresAt > Date.now()) return cached.data

    const url = `${this.oidc.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) {
      throw new BadRequestException(`OIDC discovery 请求失败（HTTP ${response.status}），请检查 OIDC_ISSUER 配置`)
    }
    const data = (await response.json()) as Partial<OidcDiscovery>
    if (!data.authorization_endpoint || !data.token_endpoint || !data.userinfo_endpoint) {
      throw new BadRequestException('OIDC discovery 响应缺少 authorization/token/userinfo 端点，请确认 IdP 支持 OpenID Connect')
    }
    this.discoveryCache = {
      data: { authorization_endpoint: data.authorization_endpoint, token_endpoint: data.token_endpoint, userinfo_endpoint: data.userinfo_endpoint },
      expiresAt: Date.now() + DISCOVERY_TTL_MS
    }
    return this.discoveryCache.data
  }

  /** 构造跳转 IdP 的授权地址（含防 CSRF 的签名 state） */
  async buildAuthorizeUrl(redirectUri: string): Promise<string> {
    const discovery = await this.discover()
    const url = new URL(discovery.authorization_endpoint)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', this.oidc.clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('scope', this.oidc.scope)
    url.searchParams.set('state', this.signState())
    return url.toString()
  }

  /** 回调处理：验证 state → code 换 token → 拉 userinfo → 解析出本地用户 */
  async handleCallback(code: string, state: string, redirectUri: string): Promise<UserEntity> {
    if (!this.verifyState(state)) {
      throw new BizException(BizErrorCode.SSO_CREDENTIAL_INVALID, 'SSO state 校验失败或已过期，请返回登录页重新发起登录')
    }
    const discovery = await this.discover()

    const tokenResponse = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: this.oidc.clientId,
        client_secret: this.oidc.clientSecret
      }),
      signal: AbortSignal.timeout(15_000)
    })
    if (!tokenResponse.ok) {
      this.logger.warn(`SSO token 端点失败：HTTP ${tokenResponse.status}`)
      throw new BadRequestException(`SSO 换取令牌失败（HTTP ${tokenResponse.status}），请检查回调地址 redirect_uri 与客户端密钥是否与 IdP 配置一致`)
    }
    const tokens = (await tokenResponse.json()) as { access_token?: string; error?: string; error_description?: string }
    if (!tokens.access_token) {
      throw new BadRequestException(`SSO 换取令牌失败：${tokens.error_description ?? tokens.error ?? 'IdP 未返回 access_token'}`)
    }

    const userinfoResponse = await fetch(discovery.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(15_000)
    })
    if (!userinfoResponse.ok) {
      throw new BadRequestException(`SSO 拉取用户信息失败（HTTP ${userinfoResponse.status}）`)
    }
    const userinfo = (await userinfoResponse.json()) as OidcUserInfo
    return this.resolveLocalUser(userinfo)
  }

  /** 按 usernameClaim / email 匹配本地账号，查无此人且允许时自动建档 */
  private async resolveLocalUser(info: OidcUserInfo): Promise<UserEntity> {
    const claimKey = this.oidc.usernameClaim
    const username = String(info[claimKey] ?? info.preferred_username ?? info.sub ?? '').trim()
    if (!username) {
      throw new BadRequestException(`IdP 的 userinfo 未返回可用标识（${claimKey} / preferred_username / sub 均为空）`)
    }
    const email = typeof info.email === 'string' && info.email.trim() ? info.email.trim() : undefined

    const userRepo = this.dataSource.getRepository(UserEntity)
    let user = await userRepo.findOne({ where: { username, delFlag: 0 } })
    // 账号对不上时退一步按邮箱匹配：IdP 改过 preferred_username 但邮箱稳定的场景
    if (!user && email) {
      user = await userRepo.findOne({ where: { email, delFlag: 0 } })
    }

    if (!user) {
      if (!this.oidc.autoCreate) {
        throw new BadRequestException('账号不存在，且系统未开启 SSO 自动建档（OIDC_AUTO_CREATE），请联系管理员创建')
      }
      user = await this.provisionUser(username, info.name, email)
      this.logger.log(`SSO 自动建档：${username}（id=${user.id}，角色=${this.oidc.defaultRoles.join(',') || '无'}）`)
    }

    if (user.status !== USER_STATUS.NORMAL) {
      throw new BadRequestException('账号已被冻结，请联系管理员')
    }
    return user
  }

  /** 自动建档：密码随机（无法走密码登录），角色按 OIDC_DEFAULT_ROLES 编码解析 */
  private async provisionUser(username: string, realname?: string, email?: string): Promise<UserEntity> {
    const roleIds = this.oidc.defaultRoles.length
      ? (await this.dataSource.getRepository(RoleEntity).find({ where: { roleCode: In(this.oidc.defaultRoles) } })).map(role => role.id)
      : undefined
    return this.userService.create(
      {
        username,
        realname: realname?.trim() || username,
        email,
        // 48 位随机密码：仅作占位（库要求非空且唯一哈希），持有人不可知 → 该账号只能 SSO 登录
        password: randomBytes(24).toString('hex'),
        roleIds
      },
      'sso'
    )
  }

  /** 为 SSO 登录成功的用户签发一次性 code（前端拿它到 exchange 换 JWT） */
  createSsoCode(userId: string): string {
    const code = randomBytes(32).toString('hex')
    const now = Date.now()
    // 顺手清理过期项，避免 Map 无限增长
    for (const [key, value] of this.ssoCodes) {
      if (value.expiresAt <= now) this.ssoCodes.delete(key)
    }
    this.ssoCodes.set(code, { userId, expiresAt: now + SSO_CODE_TTL_MS })
    return code
  }

  /** 消费一次性 code：返回用户 id；无效/过期/已用返回 null（code 立即失效，防重放） */
  consumeSsoCode(code: string): string | null {
    const entry = this.ssoCodes.get(code)
    if (!entry) return null
    this.ssoCodes.delete(code)
    return entry.expiresAt > Date.now() ? entry.userId : null
  }

  /** 按用户 id 重新加载实体（exchange 时使用） */
  async loadUserById(id: string): Promise<UserEntity | null> {
    return this.dataSource.getRepository(UserEntity).findOne({ where: { id, delFlag: 0 } })
  }

  /** state = `${exp}.${nonce}.${hmac}`：无状态签名方案，多实例无需共享会话 */
  private signState(): string {
    const payload = `${Date.now() + STATE_TTL_MS}.${randomBytes(16).toString('hex')}`
    const signature = createHmac('sha256', this.hmacSecret).update(payload).digest('hex')
    return `${payload}.${signature}`
  }

  private verifyState(state: string): boolean {
    const parts = state.split('.')
    if (parts.length !== 3) return false
    const [expiresAt, nonce, signature] = parts
    if (!Number.isFinite(Number(expiresAt)) || Number(expiresAt) < Date.now()) return false
    const expected = createHmac('sha256', this.hmacSecret).update(`${expiresAt}.${nonce}`).digest('hex')
    const a = Buffer.from(expected, 'hex')
    const b = Buffer.from(signature, 'hex')
    return a.length === b.length && timingSafeEqual(a, b)
  }
}
