import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common'

import { JwtAuthGuard } from '../guards/jwt-auth.guard'
import { AuthService } from '../services/auth.service'
import { LoginDto, RefreshTokenDto } from '../dto/login.dto'
import type { UserEntity } from '../../user/entities/user.entity'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** 登录 POST /api/auth/login */
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto)
  }

  /** 刷新令牌 POST /api/auth/refresh */
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken)
  }

  /** 当前登录用户信息 GET /api/auth/profile（需携带 Bearer token） */
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  profile(@Request() req: { user: UserEntity }) {
    return this.authService['userService'].stripPassword(req.user)
  }
}
