import { Injectable, Logger, type NestMiddleware } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { NextFunction, Request, Response } from 'express'

import { jwtConfig, type JwtConfig } from '../../config'
import { TenantAccessService } from './tenant-access.service'
import { TenantContext, type TenantStore } from './tenant.context'

/** 租户切换请求头（前端 http 层统一带上） */
export const TENANT_HEADER = 'x-tenant-id'

/**
 * 租户中间件：每个请求进入时确定「本次请求看哪个租户」，写进 AsyncLocalStorage
 *
 * 放在中间件而不是 Guard，是因为只有 `TenantContext.run(store, next)` 才能把上下文
 * 包住后续整条链路（Guard / Interceptor / Controller / Service）；
 * Guard 里设置 context 的话，一旦 handler 异步返回，run 的作用域已经结束。
 *
 * 解析顺序：
 * 1. 没有 token（登录等公开接口）→ 租户 0（只看平台共享数据，绝不跨租户泄漏）
 * 2. 有 token → 交给 TenantAccessService 校验归属，前端传的 id 不可信
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name)

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly tenantAccess: TenantAccessService
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const token = this.extractToken(req)
    if (!token) {
      TenantContext.run({ tenantId: 0, isSuper: false }, next)
      return
    }

    let userId: string | undefined
    try {
      const jwt = this.configService.get<JwtConfig>(jwtConfig.KEY)
      const payload = this.jwtService.verify<{ id?: string }>(token, { secret: jwt?.secret })
      userId = payload?.id
    } catch {
      // 令牌无效：交给 JwtAuthGuard 回 401，这里只给一个安全的空上下文
      TenantContext.run({ tenantId: 0, isSuper: false }, next)
      return
    }

    if (!userId) {
      TenantContext.run({ tenantId: 0, isSuper: false }, next)
      return
    }

    const requested = Number(req.headers[TENANT_HEADER])
    try {
      const { tenantId, membership } = await this.tenantAccess.resolveTenant(userId, Number.isFinite(requested) && requested > 0 ? requested : null)
      const store: TenantStore = { tenantId, userId, isSuper: membership.isSuper }
      TenantContext.run(store, next)
    } catch (error) {
      // 归属校验失败（403）：把异常交给全局异常过滤器，保持统一响应格式
      next(error)
    }
  }

  private extractToken(req: Request): string | undefined {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) return undefined
    return header.slice('Bearer '.length).trim() || undefined
  }
}
