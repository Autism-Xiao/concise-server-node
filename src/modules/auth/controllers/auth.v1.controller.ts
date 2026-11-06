import { Body, Controller, Get, HttpCode, HttpStatus, Post, Request } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Public } from '../../../common/decorators/public.decorator'
import { RateLimit } from '../../../common/decorators/rate-limit.decorator'
import { LoginDto, LoginResultDto, RefreshTokenDto, VerifyCaptchaDto } from '../dto/login.dto'
import { AuthService, type PermissionResult } from '../services/auth.service'
import { CaptchaService } from '../services/captcha.service'
import type { UserEntity } from '../../user/entities/user.entity'

/**
 * 认证接口 V1：/api/v1/auth/**
 *
 * 版本策略：URL 前缀做版本。旧版（/api/auth/**）已默认不注册（见 config/legacy-routes.config.ts），
 * 因此 **v1 必须自成完整能力**：验证码 / 登录 / 刷新 / 退出 / 权限汇总 / 当前用户信息。
 * 新增或修改的接口一律挂 v1。
 */
@ApiTags('认证 V1')
@Controller('v1/auth')
export class AuthV1Controller {
  constructor(
    private readonly authService: AuthService,
    private readonly captchaService: CaptchaService
  ) {}

  @ApiOperation({ summary: '获取滑块验证码（v1）', description: '返回带缺口的背景图与拼图条（PNG dataURL）及 captchaId；答案存 Redis，5 分钟有效' })
  @Public()
  @RateLimit({ limit: 30, window: 60, message: '验证码获取过于频繁，请稍后再试' })
  @Get('captcha')
  captcha() {
    return this.captchaService.create()
  }

  @ApiOperation({
    summary: '校验滑块位置（v1）',
    description: '拖动误差 ±5px 内通过，返回一次性 ticket（2 分钟有效），登录时作为 captchaTicket 传入'
  })
  @Public()
  @Post('captcha/verify')
  verifyCaptcha(@Body() dto: VerifyCaptchaDto) {
    return this.captchaService.verify(dto.captchaId, dto.x)
  }

  @ApiOperation({ summary: '登录（v1）', description: '校验验证码与账号密码，返回 accessToken / refreshToken 双令牌' })
  @ApiOkResponse({ description: '令牌对与用户信息', type: LoginResultDto })
  @Public()
  // 登录限流 60 次/分钟/IP：主要防脚本洪水；撞库由「同账号 5 次失败锁 15 分钟」+ 滑块验证码兜住，
  // 阈值不宜设太小，否则 NAT 后的整个办公室会互相误伤
  @RateLimit({ limit: 60, window: 60, message: '登录请求过于频繁，请稍后再试' })
  @HttpCode(HttpStatus.OK)
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

  @ApiOperation({ summary: '刷新令牌（v1）', description: '用 refreshToken 换取新的令牌对（轮换：旧 refreshToken 立即失效）' })
  @ApiOkResponse({ description: '新的令牌对与用户信息', type: LoginResultDto })
  @Public()
  @RateLimit({ limit: 20, window: 60, message: '刷新过于频繁，请稍后再试' })
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken)
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: '当前登录用户信息（v1）', description: '返回脱敏后的用户信息（不含 password / salt）' })
  @Get('profile')
  profile(@Request() req: { user: UserEntity }) {
    return this.authService.getProfile(req.user)
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
