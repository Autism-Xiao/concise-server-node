import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { JwtAuthGuard } from '../guards/jwt-auth.guard'
import { AuthService } from '../services/auth.service'
import { LoginDto, LoginResultDto, RefreshTokenDto } from '../dto/login.dto'
import type { UserEntity } from '../../user/entities/user.entity'

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: '登录', description: '校验账号密码，返回 accessToken / refreshToken 双令牌' })
  @ApiOkResponse({ description: '令牌对与用户信息', type: LoginResultDto })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto)
  }

  @ApiOperation({ summary: '刷新令牌', description: '用 refreshToken 换取新的令牌对' })
  @ApiOkResponse({ description: '新的令牌对与用户信息', type: LoginResultDto })
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
