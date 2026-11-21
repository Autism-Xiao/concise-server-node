import { CanActivate, ExecutionContext, HttpStatus, Injectable, Logger } from '@nestjs/common'

import { BizErrorCode } from '../enums/biz-error-code.enum'
import { BizException } from '../exceptions/biz.exception'
import { envBoolean } from '../../global/env'
import { TenantContext } from '../../shared/tenant/tenant.context'
import { RedisService } from '../../shared/redis/redis.service'
import { QuotaService } from '../../shared/quota/quota.service'
import { usagePeriod } from '../../modules/metering/metering.service'

/** 计数精度参数：基准值缓存 60s（期间 metering 落库的新增量由 Redis 增量计数器补齐） */
const BASE_TTL_SECONDS = 60
const EXTRA_TTL_SECONDS = 7200

/** 配额白名单片段：超限也不能把「查余额/登录/健康检查」关在门外，否则用户连自己为什么 429 都看不到。
 *  用「包含」而非前缀匹配：originalUrl 带 API_PREFIX（默认 /api），代理部署还可能有 /backend-api，写全前缀枚举不完备 */
const WHITELIST_SEGMENTS = ['/v1/health', '/v1/metering', '/v1/auth']

interface RequestLike {
  method?: string
  originalUrl?: string
  url?: string
}

/**
 * 租户 API 调用量配额守卫（APP_GUARD，注册在 FeatureGuard 之后）
 *
 * 与 MeteringInterceptor 的关系：metering 负责把「事实」攒批落库（≤30s 延迟），
 * 本守卫负责把「上限」变成拦截（429）。计量口径 = 全部成功请求（含 GET），
 * 月账期（sys_tenant_usage.period），限额键 tenant.quota.apiCalls（0 = 不限制）。
 *
 * 精度模型：基准值 = 落库值（缓存 60s）+ Redis 增量计数器（缓存期内的新请求）。
 * 基准值天然滞后 ≤30s（metering 攒批），配合「白名单 + fail-open」，
 * 本守卫的定位是配额闸门而非计费精度，宁可少拦不多拦。
 *
 * 降级策略：Redis 不可用时直接放行（fail-open）——限流可以退内存计数，
 * 这里若也做内存计数，多实例部署下各实例独立计数会导致误拦，干脆放行。
 */
@Injectable()
export class QuotaGuard implements CanActivate {
  private readonly logger = new Logger(QuotaGuard.name)

  constructor(
    private readonly quota: QuotaService,
    private readonly redis: RedisService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!envBoolean('API_QUOTA_ENABLED', true)) {
      return true
    }
    const request = context.switchToHttp().getRequest<RequestLike>()
    if (!request) {
      return true
    }
    // 平台视角（tenantId=null）与匿名（0）不参与租户配额
    const tenantId = TenantContext.filterTenantId()
    if (!(tenantId && tenantId > 0)) {
      return true
    }
    const path = (request.originalUrl ?? request.url ?? '').split('?')[0]
    if (WHITELIST_SEGMENTS.some(segment => path.includes(segment))) {
      return true
    }

    const limit = await this.quota.apiCallsLimit(tenantId)
    if (!(limit > 0)) {
      return true
    }

    const client = this.redis.client
    if (!client) {
      return true
    }
    const period = usagePeriod()
    const baseKey = `quota:api:base:${tenantId}:${period}`
    const extraKey = `quota:api:extra:${tenantId}:${period}`
    try {
      // 基准值：优先取缓存；过期则读落库值（不主动 flush，滞后 ≤30s 由增量计数器语义补齐）
      let base = Number(await client.get(baseKey))
      if (!Number.isFinite(base)) {
        base = await this.quota.apiCallsUsed(tenantId, period)
        await client.set(baseKey, String(base), 'EX', BASE_TTL_SECONDS)
        // 基准刷新后增量窗口重开（SET 无 TTL 前的旧增量已被新基准覆盖）
        await client.del(extraKey)
      }
      const extra = await client.incr(extraKey)
      if (extra === 1) {
        await client.expire(extraKey, EXTRA_TTL_SECONDS)
      }
      if (base + extra > limit) {
        throw new BizException(BizErrorCode.RATE_LIMITED, `租户本月 API 调用量已达上限（${limit} 次），请联系管理员调整配额`, HttpStatus.TOO_MANY_REQUESTS)
      }
      return true
    } catch (error) {
      // 只吞 Redis 故障：BizException（真超限）原样抛出
      if (error instanceof BizException) {
        throw error
      }
      this.logger.warn(`API 配额检查降级放行（Redis 异常）：${(error as Error).message}`)
      return true
    }
  }
}
