import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiBearerAuth, ApiExcludeController, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Public } from '../../../common/decorators/public.decorator'
import { JwtAuthGuard } from '../guards/jwt-auth.guard'
import { AuthService } from '../services/auth.service'
import { CaptchaService } from '../services/captcha.service'
import { LoginDto, LoginResultDto, RefreshTokenDto } from '../dto/login.dto'
import type { UserEntity } from '../../user/entities/user.entity'

// 旧版无前缀接口：仅为向后兼容保留，不出现在 Swagger 文档中（文档只暴露 V1 + 系统分组）
@ApiExcludeController()
@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly captchaService: CaptchaService,
    private readonly configService: ConfigService
  ) {}

  @ApiOperation({ summary: '获取图形验证码', description: 'CAPTCHA_ENABLED=true 时登录必用；返回 SVG 与 captchaId' })
  @Public()
  @Get('captcha')
  async captcha() {
    // CAPTCHA_DEBUG=true 时附带明文 code（仅限开发环境，生产必须关闭）
    const debug = this.configService.get<string>('CAPTCHA_DEBUG') === 'true'
    return this.captchaService.generate(debug)
  }

  @ApiOperation({ summary: '登录', description: '校验账号密码，返回 accessToken / refreshToken 双令牌' })
  @ApiOkResponse({ description: '令牌对与用户信息', type: LoginResultDto })
  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Request() req: { ip: string; headers: Record<string, string | string[] | undefined> }) {
    const userAgent = req.headers['user-agent']
    return this.authService.login(dto, { ip: req.ip ?? '', userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent })
  }

  @ApiOperation({ summary: '刷新令牌', description: '用 refreshToken 换取新的令牌对' })
  @ApiOkResponse({ description: '新的令牌对与用户信息', type: LoginResultDto })
  @Public()
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
