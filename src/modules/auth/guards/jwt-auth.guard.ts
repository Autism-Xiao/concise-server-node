import { Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

/** JWT 认证守卫：@UseGuards(JwtAuthGuard) 或注册为全局守卫后按需 @Public() 放行 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
