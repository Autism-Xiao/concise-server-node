import { Body, Controller, Get, Inject, Post, Request } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { captchaConfig, type CaptchaConfig } from '../../../config'
import { Public } from '../../../common/decorators/public.decorator'
import { LoginDto, LoginResultDto } from '../dto/login.dto'
import { AuthService, type PermissionResult } from '../services/auth.service'
import { CaptchaService } from '../services/captcha.service'

/**
 * 认证接口 V1：/api/v1/auth/**
 *
 * 版本策略：URL 前缀做版本，老版本路由（/api/auth/**）继续保留，前端可逐个切换；
 * 等其余模块也迁到 v1 后，旧路由再统一下线。
 * 目前：验证码 / 登录 / 权限汇总在 v1，refresh / profile 仍在旧路由。
 * 约定：后续新增或修改的接口一律挂在 v1 下。
 */
@ApiTags('认证 V1')
@Controller('v1/auth')
export class AuthV1Controller {
  constructor(
    private readonly authService: AuthService,
    private readonly captchaService: CaptchaService,
    @Inject(captchaConfig.KEY) private readonly captchaCfg: CaptchaConfig
  ) {}

  @ApiOperation({ summary: '获取图形验证码（v1）', description: 'CAPTCHA_ENABLED=true 时登录必用；返回 SVG 与 captchaId' })
  @Public()
  @Get('captcha')
  async captcha() {
    // captcha.debug=true 时附带明文 code（仅限开发环境，生产必须关闭）
    return this.captchaService.generate(this.captchaCfg.debug)
  }

  @ApiOperation({ summary: '登录（v1）', description: '校验验证码与账号密码，返回 accessToken / refreshToken 双令牌' })
  @ApiOkResponse({ description: '令牌对与用户信息', type: LoginResultDto })
  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Request() req: { ip: string; headers: Record<string, string | string[] | undefined> }) {
    const userAgent = req.headers['user-agent']
    return this.authService.login(dto, { ip: req.ip ?? '', userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent })
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: '退出登录（v1）',
    description: 'accessToken 立即失效（进黑名单）并删除在线会话；body 里带 refreshToken 时一并失效，防止登出后刷新续命。'
  })
  @Post('logout')
  logout(@Request() req: { headers: Record<string, string | string[] | undefined> }, @Body() body?: { refreshToken?: string }) {
    const header = req.headers.authorization
    const raw = Array.isArray(header) ? header[0] : header
    const token = raw?.split(' ')[1] ?? ''
    if (!token) {
      return { loggedOut: true }
    }
    return this.authService.logout(token, body?.refreshToken)
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: '获取当前用户权限（v1）',
    description: '登录后调用一次：角色 code、按钮权限汇总（超管为 ["*"]）、按角色过滤的菜单树（侧边栏数据源）'
  })
  @ApiOkResponse({ description: '权限汇总', type: Object as () => PermissionResult })
  @Get('permissions')
  permissions(@Request() req: { user: { id: string } }) {
    return this.authService.getPermissions(req.user.id)
  }
}
