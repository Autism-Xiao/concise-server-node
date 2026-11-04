import { Body, Controller, Get, Post, Request } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Public } from '../../../common/decorators/public.decorator'
import { LoginDto, LoginResultDto } from '../dto/login.dto'
import { AuthService } from '../services/auth.service'
import { CaptchaService } from '../services/captcha.service'

/**
 * 认证接口 V1：/api/v1/auth/**
 *
 * 版本策略：URL 前缀做版本，老版本路由（/api/auth/**）继续保留，前端可逐个切换；
 * 等其余模块也迁到 v1 后，旧路由再统一下线。
 * 目前只迁「验证码 + 登录」两个入口，refresh / profile 仍在旧路由。
 */
@ApiTags('认证 V1')
@Controller('v1/auth')
export class AuthV1Controller {
  constructor(
    private readonly authService: AuthService,
    private readonly captchaService: CaptchaService,
    private readonly configService: ConfigService
  ) {}

  @ApiOperation({ summary: '获取图形验证码（v1）', description: 'CAPTCHA_ENABLED=true 时登录必用；返回 SVG 与 captchaId' })
  @Public()
  @Get('captcha')
  async captcha() {
    // CAPTCHA_DEBUG=true 时附带明文 code（仅限开发环境，生产必须关闭）
    const debug = this.configService.get<string>('CAPTCHA_DEBUG') === 'true'
    return this.captchaService.generate(debug)
  }

  @ApiOperation({ summary: '登录（v1）', description: '校验验证码与账号密码，返回 accessToken / refreshToken 双令牌' })
  @ApiOkResponse({ description: '令牌对与用户信息', type: LoginResultDto })
  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Request() req: { ip: string; headers: Record<string, string | string[] | undefined> }) {
    const userAgent = req.headers['user-agent']
    return this.authService.login(dto, { ip: req.ip ?? '', userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent })
  }
}
