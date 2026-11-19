import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common'
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger'
import { JwtService } from '@nestjs/jwt'
import { IsIn, IsString, Length } from 'class-validator'
import type { ConfigType } from '@nestjs/config'

import { jwtConfig } from '../../config'
import { Public } from '../../common/decorators/public.decorator'
import { RawResponse } from '../../common/decorators/raw-response.decorator'
import { RateLimit } from '../../common/decorators/rate-limit.decorator'
import { AppService } from './app.service'
import { APP_TOKEN_EXPIRES_IN } from './openapi.constants'

/** OAuth2 client_credentials 请求体（JSON；也接受 form 编码，由全局管道统一转 JSON 后进入） */
class AppTokenDto {
  @ApiProperty({ description: '客户端 ID', example: 'app_1a2b3c4d5e6f7081' })
  @IsString({ message: 'client_id 必须是字符串' })
  @Length(1, 64, { message: 'client_id 长度须在 1~64' })
  client_id!: string

  @ApiProperty({ description: '客户端密钥（创建/重置时返回的那次明文）' })
  @IsString({ message: 'client_secret 必须是字符串' })
  @Length(1, 128, { message: 'client_secret 长度须在 1~128' })
  client_secret!: string

  @ApiProperty({ description: '授权类型，固定 client_credentials', example: 'client_credentials' })
  @IsIn(['client_credentials'], { message: 'grant_type 只支持 client_credentials' })
  grant_type!: string
}

/**
 * 开放平台令牌端点（OAuth2 client_credentials 子集）
 *
 * 响应按 OAuth2 惯例用 snake_case（access_token / token_type / expires_in），
 * 不走统一响应包装 —— 对接方是拿现成 OAuth2 客户端库调的，别让人家改解析逻辑。
 */
@ApiTags('开放平台')
@Controller('v1/open')
export class TokenV1Controller {
  constructor(
    private readonly appService: AppService,
    private readonly jwtService: JwtService,
    @Inject(jwtConfig.KEY) private readonly jwt: ConfigType<typeof jwtConfig>
  ) {}

  @Public()
  @RawResponse()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 20, window: 60, by: 'ip' })
  @ApiOperation({
    summary: '换取应用访问令牌',
    description: 'client_credentials 模式：客户端 ID + 密钥换短期访问令牌（2 小时）。失败统一 401 语义，不区分账号或密钥错误。'
  })
  @Post('token')
  async issueToken(@Body() dto: AppTokenDto) {
    const app = await this.appService.verifyCredentials(dto.client_id, dto.client_secret)
    const accessToken = await this.jwtService.signAsync(
      // tenantId 给 TenantMiddleware 用：应用令牌没有用户归属，不能拿 app.id 去查 sys_user。
      // JwtStrategy 会重新查库确认应用状态/归属租户，这里的值只负责把请求上下文指到正确租户。
      { id: app.id, username: app.appName, app: true, tenantId: app.tenantId, scopes: this.appService.parseScopes(app) },
      { secret: this.jwt.secret, expiresIn: APP_TOKEN_EXPIRES_IN }
    )
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: APP_TOKEN_EXPIRES_IN,
      scope: this.appService.parseScopes(app).join(' ')
    }
  }
}
