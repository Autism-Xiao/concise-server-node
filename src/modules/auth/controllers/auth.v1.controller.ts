import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Ip, Post, Put, Request, UnauthorizedException } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Public } from '../../../common/decorators/public.decorator'
import { RateLimit } from '../../../common/decorators/rate-limit.decorator'
import { captchaConfig, type CaptchaConfig } from '../../../config/captcha.config'
import { ChangePasswordDto } from '../dto/change-password.dto'
import { LoginDto, LoginResultDto, RefreshTokenDto, VerifyCaptchaDto } from '../dto/login.dto'
import { ForgotPasswordDto, ResetByCodeDto } from '../dto/password-reset.dto'
import { TwoFactorCodeDto } from '../dto/two-factor.dto'
import { TwoFactorDeactivateDto, TwoFactorPasswordDto } from '../dto/two-factor-password.dto'
import { VerifyPasswordDto } from '../dto/verify-password.dto'
import { AuthService, type PermissionResult } from '../services/auth.service'
import { CaptchaService } from '../services/captcha.service'
import { PasswordResetService } from '../services/password-reset.service'
import { RememberMeService } from '../services/remember-me.service'
import { TotpService } from '../services/totp.service'
import type { UserEntity } from '../../user/entities/user.entity'

/**
 * 认证接口 V1：/api/v1/auth/**
 *
 * 版本策略：URL 前缀做版本。旧版（/api/auth/**）已下线删除，
 * 因此 **v1 必须自成完整能力**：验证码 / 登录 / 刷新 / 退出 / 权限汇总 / 当前用户信息。
 * 新增或修改的接口一律挂 v1。
 */
@ApiTags('认证 V1')
@Controller('v1/auth')
export class AuthV1Controller {
  constructor(
    private readonly authService: AuthService,
    private readonly captchaService: CaptchaService,
    private readonly totpService: TotpService,
    private readonly passwordResetService: PasswordResetService,
    private readonly rememberMeService: RememberMeService,
    @Inject(captchaConfig.KEY) private readonly captcha: CaptchaConfig
  ) {}

  @ApiOperation({
    summary: '获取滑块验证码（v1）',
    description:
      '返回带缺口的背景图与拼图条（PNG dataURL）及 captchaId；答案存 Redis，5 分钟有效。' +
      'CAPTCHA_ENABLED=false 时返回 { enabled: false } 且不出图：前端据此隐藏滑块、登录不传 captchaTicket。' +
      '否则关闭了验证码（尤其同时没启 Redis）的部署会卡在「取不到验证码就不许提交」，登录页进不去'
  })
  @Public()
  @RateLimit({ limit: 30, window: 60, message: '验证码获取过于频繁，请稍后再试' })
  @Get('captcha')
  async captchaChallenge() {
    // 关闭验证码时完全不碰 Redis：直接告诉前端「不需要验证」，而不是抛 503 让前端卡死
    if (!this.captcha.enabled) return { enabled: false }
    const data = await this.captchaService.create()
    return { enabled: true, ...data }
  }

  @ApiOperation({
    summary: '校验滑块位置（v1）',
    description: '拖动误差 ±3px 内通过，返回一次性 ticket（2 分钟有效），登录时作为 captchaTicket 传入'
  })
  @Public()
  // verify 有独立限流（30 次/分钟/IP）：每次验证要申请新挑战 + 出图，没有这层的话
  // 脚本可以高频「取图→瞎拖」撞概率（±3 容差约 4.6% 中奖率，限流后撞不开）
  @RateLimit({ limit: 30, window: 60, message: '验证尝试过于频繁，请稍后再试' })
  @Post('captcha/verify')
  verifyCaptcha(@Body() dto: VerifyCaptchaDto) {
    return this.captchaService.verify(dto.captchaId, dto.x)
  }

  @ApiOperation({ summary: '登录（v1）', description: '校验验证码与账号密码，返回 accessToken / refreshToken 双令牌' })
  @ApiOkResponse({ description: '令牌对与用户信息', type: LoginResultDto })
  @Public()
  // 登录限流 120 次/分钟/IP：主要防脚本洪水；撞库由「同账号连错 5 次锁 24 小时（可配）」+ 滑块验证码兜住，
  // 阈值不宜设太小，否则 NAT 后的整个办公室会互相误伤
  @RateLimit({ limit: 120, window: 60, message: '登录请求过于频繁，请稍后再试' })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto, @Request() req: { ip: string; headers: Record<string, string | string[] | undefined>; body?: Record<string, unknown> }) {
    const userAgent = req.headers['user-agent']
    const result = (await this.authService.login(dto, {
      ip: req.ip ?? '',
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent
    })) as unknown as Record<string, unknown>

    // 「记住登录」（方案 C）：登录成功且前端勾选时签发 Redis 凭证（不存密码，只存 refresh 链头）。
    // rememberMe/rememberDays/deviceId 不进 LoginDto（全局 whitelist 会剥掉 DTO 外字段），从原始 body 读取；
    // 签发失败（Redis 关/开关关）静默降级为「不记住」，绝不影响登录本身
    const raw = (req.body ?? {}) as Record<string, unknown>
    if (!raw.rememberMe) return result
    try {
      const remember = await this.rememberMeService.issue({
        userId: String((result.userInfo as { id?: string } | undefined)?.id ?? ''),
        deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : undefined,
        days: typeof raw.rememberDays === 'number' ? raw.rememberDays : undefined,
        refreshToken: typeof result.refreshToken === 'string' ? result.refreshToken : ''
      })
      if (remember) return { ...result, rememberToken: remember.token, rememberDays: remember.days }
    } catch {
      // Redis 异常等：记住功能降级，不阻塞登录
    }
    return result
  }

  @ApiOperation({
    summary: '记住登录凭证换取令牌（v1）',
    description:
      '用登录时签发的记住凭证免密换新令牌对（走 refreshToken 轮换，新链头写回记录）' +
      '设备绑定校验失败/凭证失效/refresh 链断裂（改密、重置密码、封号触发的全量下线）一律 401 并清理记录'
  })
  @Public()
  @RateLimit({ limit: 20, window: 60, message: '续登请求过于频繁，请稍后再试' })
  @HttpCode(HttpStatus.OK)
  @Post('remember/exchange')
  rememberExchange(@Body() body?: { token?: string; deviceId?: string }) {
    const token = typeof body?.token === 'string' ? body.token : ''
    if (!token) throw new UnauthorizedException('缺少登录凭证')
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : undefined
    return this.rememberMeService.exchange(token, deviceId)
  }

  @ApiOperation({
    summary: '吊销记住登录凭证（v1）',
    description: '登出时前端带上自己的凭证调用；幂等，token 不存在也返回成功'
  })
  @Public()
  @RateLimit({ limit: 30, window: 60, message: '吊销请求过于频繁，请稍后再试' })
  @HttpCode(HttpStatus.OK)
  @Post('remember/revoke')
  async rememberRevoke(@Body() body?: { token?: string }) {
    const token = typeof body?.token === 'string' ? body.token : ''
    if (token) await this.rememberMeService.revoke(token)
    return { revoked: true }
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
  @ApiOperation({
    summary: '修改当前用户密码（v1）',
    description: '校验原密码后写入新密码；改密成功后所有端（含当前设备）全部下线，前端应引导重新登录。新密码不能与原密码相同'
  })
  // 限流守卫在认证之前执行，req.user 还不存在，by:'account' 拿不到账号会退化成按 IP；
  // 这里只做防滥用兜底（20 次/5 分钟/IP），真正的安全闸门是「原密码校验」
  @RateLimit({ limit: 20, window: 300, message: '修改密码过于频繁，请稍后再试' })
  @Put('password')
  async changePassword(@Request() req: { user: { id: string; username: string } }, @Body() dto: ChangePasswordDto) {
    const result = await this.authService.changePassword(req.user.id, dto)
    // 改密成功 = 旧凭证可能已泄露：吊销该用户全部「记住登录」凭证（会话下线已断 refresh 链，这里兜底清记录）
    await this.rememberMeService.revokeUser(req.user.id)
    return result
  }

  @ApiOperation({
    summary: '申请重置密码验证码（v1）',
    description:
      '向账号绑定邮箱发 6 位一次性验证码（有效期见系统参数 mail.resetCode.ttlMinutes，默认 5 分钟）。' +
      '无论账号是否存在、是否绑邮箱，一律返回 sent:true，防止被当成账号探测器'
  })
  @Public()
  @RateLimit({ limit: 5, window: 300, message: '申请重置密码过于频繁，请稍后再试' })
  @HttpCode(HttpStatus.OK)
  @Post('password/forgot')
  forgotPassword(@Body() dto: ForgotPasswordDto, @Ip() ip: string) {
    return this.passwordResetService.request(dto.account, ip)
  }

  @ApiOperation({
    summary: '用验证码重置密码（v1）',
    description: '校验邮件验证码后写入新密码（受密码策略约束）；验证码只能成功使用一次，试错 5 次作废'
  })
  @Public()
  @RateLimit({ limit: 10, window: 300, message: '重置密码过于频繁，请稍后再试' })
  @HttpCode(HttpStatus.OK)
  @Post('password/reset-by-code')
  resetPasswordByCode(@Body() dto: ResetByCodeDto) {
    return this.passwordResetService.reset(dto.account, dto.code, dto.newPassword)
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: '两步验证状态（v1）', description: '返回当前账号是否已开启 TOTP 两步验证（账户设置页展示用）' })
  @Get('2fa/status')
  twoFactorStatus(@Request() req: { user: { id: string } }) {
    return this.totpService.getStatus(req.user.id)
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: '发起两步验证绑定（v1）',
    description: '生成 TOTP 密钥与 otpauth:// URI（前端渲染二维码）。覆盖式：重复调用会换新密钥，旧二维码立即作废'
  })
  @RateLimit({ limit: 10, window: 300, message: '操作过于频繁，请稍后再试' })
  @HttpCode(HttpStatus.OK)
  @Post('2fa/setup')
  twoFactorSetup(@Request() req: { user: { id: string; username: string } }, @Body() dto: TwoFactorPasswordDto) {
    return this.totpService.setup(req.user.id, req.user.username, dto.password)
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: '激活两步验证（v1）', description: '校验 6 位动态码后正式开启；开启后登录必须携带 totpCode' })
  @RateLimit({ limit: 10, window: 300, message: '验证码尝试过于频繁，请稍后再试' })
  @HttpCode(HttpStatus.OK)
  @Post('2fa/activate')
  twoFactorActivate(@Request() req: { user: { id: string } }, @Body() dto: TwoFactorCodeDto) {
    return this.totpService.activate(req.user.id, dto.code)
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: '关闭两步验证（v1）', description: '校验 6 位动态码后关闭并清除密钥，登录恢复为仅密码' })
  @RateLimit({ limit: 10, window: 300, message: '验证码尝试过于频繁，请稍后再试' })
  @HttpCode(HttpStatus.OK)
  @Post('2fa/deactivate')
  twoFactorDeactivate(@Request() req: { user: { id: string } }, @Body() dto: TwoFactorDeactivateDto) {
    return this.totpService.deactivate(req.user.id, dto.code, dto.password)
  }

  @ApiOperation({ summary: '重新生成备份恢复码', description: '需当前动态码；旧码全部作废，明文只返回一次' })
  @RateLimit({ limit: 10, window: 300, message: '操作过于频繁，请稍后再试' })
  @HttpCode(HttpStatus.OK)
  @Post('2fa/backup-codes')
  twoFactorBackupCodes(@Request() req: { user: { id: string } }, @Body() dto: TwoFactorCodeDto) {
    return this.totpService.regenerateBackupCodes(req.user.id, dto.code)
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: '当前登录用户信息（v1）', description: '返回脱敏后的用户信息（不含 password / salt）' })
  @Get('profile')
  profile(@Request() req: { user: UserEntity }) {
    return this.authService.getProfile(req.user)
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: '校验当前用户密码（v1）',
    description:
      '锁屏解锁等场景校验密码；失败与登录共用失败锁定计数（连错 5 次锁 24 小时）。' +
      '校验通过会顺带清除该账号的服务端锁屏标志（lock:screen:*）——锁屏页调本接口即完成解锁'
  })
  // 限流守卫在认证之前执行，req.user 还不存在，by:'account' 退化成按 IP；
  // 这里只做防滥用兜底（20 次/5 分钟/IP），真正的安全闸门是「失败共享登录锁定计数」
  @RateLimit({ limit: 20, window: 300, message: '密码校验过于频繁，请稍后再试' })
  @HttpCode(HttpStatus.OK)
  @Post('verify-password')
  verifyPassword(@Request() req: { user: { username: string } }, @Body() dto: VerifyPasswordDto) {
    return this.authService.verifyPassword(req.user.username, dto.password)
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: '锁屏（v1）',
    description:
      '锁标志存服务端（Redis，TTL 默认 24h 自愈），状态源在服务端而非浏览器本地：' +
      '关机重开/换设备/清缓存都会被锁屏拦住。按账号维度（A 端锁屏，B 端同账号一并锁）。' +
      'Redis 不可用时 fail-open：仅当前会话本地锁住、不持久化'
  })
  @HttpCode(HttpStatus.OK)
  @Post('lock')
  lock(@Request() req: { user: { id: string } }) {
    return this.authService.lockScreen(req.user.id)
  }

  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: '查询锁屏状态（v1）',
    description: '前端启动时以本接口结果纠正本地锁屏标志；任何查询失败都按未锁处理（fail-open）'
  })
  @Get('lock-state')
  lockState(@Request() req: { user: { id: string } }) {
    return this.authService.getScreenLockState(req.user.id)
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
