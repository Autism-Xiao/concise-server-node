import { Body, Controller, Get, HttpCode, HttpStatus, Post, Request, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiExcludeController, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Public } from '../../../common/decorators/public.decorator'
import { RateLimit } from '../../../common/decorators/rate-limit.decorator'
import { JwtAuthGuard } from '../guards/jwt-auth.guard'
import { AuthService } from '../services/auth.service'
import { CaptchaService } from '../services/captcha.service'
import { LoginDto, LoginResultDto, RefreshTokenDto, VerifyCaptchaDto } from '../dto/login.dto'
import type { UserEntity } from '../../user/entities/user.entity'

// 旧版无前缀接口：仅为向后兼容保留，不出现在 Swagger 文档中（文档只暴露 V1 + 系统分组）
@ApiExcludeController()
@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly captchaService: CaptchaService
  ) {}

  @ApiOperation({ summary: '获取滑块验证码', description: '返回带缺口的背景图与拼图条（PNG dataURL）及 captchaId' })
  @Public()
  @RateLimit({ limit: 30, window: 60, message: '验证码获取过于频繁，请稍后再试' })
  @Get('captcha')
  captcha() {
    return this.captchaService.create()
  }

  @ApiOperation({ summary: '校验滑块位置', description: '误差 ±5px 内通过，返回一次性 ticket，登录时作为 captchaTicket 传入' })
  @Public()
  @Post('captcha/verify')
  verifyCaptcha(@Body() dto: VerifyCaptchaDto) {
    return this.captchaService.verify(dto.captchaId, dto.x)
  }

  @ApiOperation({ summary: '登录', description: '校验账号密码，返回 accessToken / refreshToken 双令牌' })
  @ApiOkResponse({ description: '令牌对与用户信息', type: LoginResultDto })
  @Public()
  // 登录限流 60 次/分钟/IP（与 v1 保持一致）；撞库由账号级失败锁定兜住
  @RateLimit({ limit: 60, window: 60, message: '登录请求过于频繁，请稍后再试' })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto, @Request() req: { ip: string; headers: Record<string, string | string[] | undefined> }) {
    const userAgent = req.headers['user-agent']
    return this.authService.login(dto, { ip: req.ip ?? '', userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent })
  }

  @ApiOperation({ summary: '刷新令牌', description: '用 refreshToken 换取新的令牌对（轮换：旧 refreshToken 立即失效）' })
  @ApiOkResponse({ description: '新的令牌对与用户信息', type: LoginResultDto })
  @Public()
  @RateLimit({ limit: 20, window: 60, message: '刷新过于频繁，请稍后再试' })
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken)
  }

  @ApiOperation({ summary: '当前登录用户信息' })
  @ApiBearerAuth('jwt')
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  profile(@Request() req: { user: UserEntity }) {
    return this.authService['userService'].stripPassword(req.user)
  }
}
