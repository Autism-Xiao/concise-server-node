import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Logger, Post, Query, Request, Res } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'

import { appConfig, oidcConfig, type AppConfig, type OidcConfig } from '../../../config'
import { BizErrorCode } from '../../../common/enums/biz-error-code.enum'
import { BizException } from '../../../common/exceptions/biz.exception'
import { Public } from '../../../common/decorators/public.decorator'
import { RateLimit } from '../../../common/decorators/rate-limit.decorator'
import { AuthService, type LoginResult } from '../services/auth.service'
import { SsoService } from '../services/sso.service'
import { ExchangeSsoCodeDto } from '../dto/sso.dto'
import { LoginResultDto } from '../dto/login.dto'

interface SsoCallbackQuery {
  code?: string
  state?: string
  error?: string
  error_description?: string
}

/**
 * SSO 单点登录接口 V1：/api/v1/auth/sso/**
 *
 * 流程：前端跳 authorize（302 到 IdP）→ IdP 回调 callback（浏览器导航，错误也用 302 带 query 回前端）
 * → 前端 /sso-callback 页拿 sso_code 调 exchange 换本项目 JWT。
 * 注意 callback 的错误不能抛 JSON（浏览器在导航中，看不到），一律 302 到前端错误提示。
 */
@ApiTags('认证 V1 · SSO')
@Controller('v1/auth/sso')
export class SsoV1Controller {
  private readonly logger = new Logger(SsoV1Controller.name)

  constructor(
    private readonly ssoService: SsoService,
    private readonly authService: AuthService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
    @Inject(oidcConfig.KEY) private readonly oidc: OidcConfig
  ) {}

  @ApiOperation({ summary: 'SSO 配置（v1）', description: '登录页据此决定是否展示「单点登录」按钮' })
  @Public()
  @Get('config')
  config() {
    return { enabled: this.oidc.enabled }
  }

  @ApiOperation({ summary: '发起 SSO 登录（v1）', description: '302 跳转到 IdP 授权页；未启用时返回 400' })
  @Public()
  @RateLimit({ limit: 30, window: 60, message: 'SSO 跳转过快，请稍后再试' })
  @Get('authorize')
  async authorize(@Request() req: { protocol: string; get?: (name: string) => string | undefined }, @Res() res: Response) {
    if (!this.oidc.enabled) {
      res.status(HttpStatus.BAD_REQUEST).json({ code: 400, message: 'SSO 未启用（OIDC_ENABLED=false）', data: null })
      return
    }
    const url = await this.ssoService.buildAuthorizeUrl(this.resolveRedirectUri(req))
    res.redirect(302, url)
  }

  @ApiOperation({
    summary: 'IdP 回调（v1）',
    description: '浏览器从 IdP 携带 code/state 回跳；成功 302 到前端 frontendRedirect?sso_code=xxx，失败 302 带 error 文案'
  })
  @Public()
  @RateLimit({ limit: 30, window: 60, message: 'SSO 回调过快，请稍后再试' })
  @Get('callback')
  async callback(
    @Query() query: string & SsoCallbackQuery,
    @Request() req: { protocol: string; get?: (name: string) => string | undefined },
    @Res() res: Response
  ) {
    const frontend = this.oidc.frontendRedirect
    const backWithError = (message: string) => res.redirect(302, `${frontend}${frontend.includes('?') ? '&' : '?'}error=${encodeURIComponent(message)}`)
    try {
      if (!this.oidc.enabled) return backWithError('SSO 未启用')
      // IdP 可能直接回 error（用户拒绝授权等）
      if (query.error) return backWithError(query.error_description ?? query.error)
      if (!query.code || !query.state) return backWithError('回调缺少 code/state 参数')
      const user = await this.ssoService.handleCallback(query.code, query.state, this.resolveRedirectUri(req))
      const ssoCode = this.ssoService.createSsoCode(user.id)
      res.redirect(302, `${frontend}${frontend.includes('?') ? '&' : '?'}sso_code=${ssoCode}`)
    } catch (error) {
      // 浏览器导航场景：异常转成可读文案回前端，绝不丢一个白屏/裸 JSON
      const message = error instanceof Error ? error.message : 'SSO 登录失败'
      this.logger.warn(`[SSO] callback 失败：${message}`)
      return backWithError(message)
    }
  }

  @ApiOperation({
    summary: '用一次性 code 换取令牌（v1）',
    description: '前端 /sso-callback 页调用；code 2 分钟有效且只能用一次，换取 accessToken / refreshToken 与用户信息'
  })
  @ApiOkResponse({ description: '令牌对与用户信息', type: LoginResultDto })
  @Public()
  @RateLimit({ limit: 30, window: 60, message: 'SSO 换取令牌过于频繁，请稍后再试' })
  @HttpCode(HttpStatus.OK)
  @Post('exchange')
  async exchange(
    @Body() dto: ExchangeSsoCodeDto,
    @Request() req: { ip: string; headers: Record<string, string | string[] | undefined> }
  ): Promise<LoginResult> {
    const userId = this.ssoService.consumeSsoCode(dto.code)
    const user = userId ? await this.ssoService.loadUserById(userId) : null
    if (!user) {
      throw new BizException(BizErrorCode.SSO_CREDENTIAL_INVALID, 'SSO 登录凭证无效或已过期，请重新发起登录', HttpStatus.BAD_REQUEST)
    }
    const userAgent = req.headers['user-agent']
    return this.authService.ssoLogin(user, { ip: req.ip ?? '', userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent })
  }

  /** 回调地址：显式配置优先，否则按当前请求的协议/域名推导 */
  private resolveRedirectUri(req: { protocol: string; get?: (name: string) => string | undefined }): string {
    if (this.oidc.redirectUri) return this.oidc.redirectUri
    const host = req.get?.('host') ?? 'localhost:3000'
    return `${req.protocol}://${host}/${this.app.globalPrefix}/v1/auth/sso/callback`
  }
}
