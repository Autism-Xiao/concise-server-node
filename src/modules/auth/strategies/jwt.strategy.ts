import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'

import { UserService } from '../../user/user.service'
import type { JwtPayload } from '../services/auth.service'

/** 从 Authorization: Bearer <token> 解析并校验 accessToken */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly userService: UserService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') as string
    })
  }

  /** 校验通过后触发：确认用户仍存在且未冻结（带角色，供 RolesGuard 使用），返回值挂到 req.user */
  async validate(payload: JwtPayload) {
    const user = await this.userService.findOneWithRoles(String(payload.id))
    if (!user || user.status !== 1) {
      throw new UnauthorizedException('账号不存在或已被冻结')
    }
    return user
  }
}
