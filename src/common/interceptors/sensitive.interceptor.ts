import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable, mergeMap } from 'rxjs'

import { PermissionCacheService } from '../../shared/permission-cache/permission-cache.service'
import { TenantContext } from '../../shared/tenant/tenant.context'
import { SENSITIVE_KEY, SENSITIVE_VIEW_PERM } from '../decorators/sensitive.decorator'

type PlainObject = Record<string, unknown>
const isObject = (value: unknown): value is PlainObject => !!value && typeof value === 'object' && !Buffer.isBuffer(value)

/** 从 handler 返回值里挑出要处理的对象：分页的 records / 数组 / 单个对象 */
function responseObjects(data: unknown): PlainObject[] {
  if (Array.isArray(data)) return data.filter(isObject)
  if (!isObject(data)) return []
  if (Array.isArray(data.records)) return data.records.filter(isObject)
  return [data]
}

/**
 * 字段级脱敏拦截器（响应层）
 *
 * 判定口径与 PermsGuard 一致：先按角色权限集合，再与租户套餐菜单交集；
 * 平台管理员 bypass，应用令牌（无角色）一律脱敏。缓存异常时 fail-closed（宁可少展示，不泄露）。
 *
 * 为什么不用 ClassSerializerInterceptor + @Exclude：那是全局无差别的，且实体写路径也复用，
 * 这里只需要两个模块、按运行时权限决定，作用面越小越安全。
 */
@Injectable()
export class SensitiveInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionCache: PermissionCacheService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const fields = this.reflector.getAllAndOverride<string[] | undefined>(SENSITIVE_KEY, [context.getHandler(), context.getClass()])
    if (!fields?.length) return next.handle()

    const request = context.switchToHttp().getRequest<{ user?: PlainObject }>()
    return next.handle().pipe(mergeMap(data => this.apply(data, fields, request.user)))
  }

  private async apply(data: unknown, fields: string[], user?: PlainObject): Promise<unknown> {
    if (await this.canViewSensitive(user)) return data

    for (const item of responseObjects(data)) {
      const removed = fields.filter(field => Object.prototype.hasOwnProperty.call(item, field) && item[field] !== null && item[field] !== undefined)
      for (const field of removed) delete item[field]
      if (removed.length) {
        const existing = Array.isArray(item.maskedFields) ? (item.maskedFields as string[]) : []
        item.maskedFields = [...new Set([...existing, ...removed])]
      }
    }
    return data
  }

  private async canViewSensitive(user?: PlainObject): Promise<boolean> {
    if (!user || user.isApp === true) return false
    if (Number(user.isPlatformAdmin ?? 0) === 1) return true

    const rawRoles = Array.isArray(user.roles) ? user.roles : []
    const roleIds = rawRoles.map(role => String((role as PlainObject).id ?? '')).filter(Boolean)
    if (!roleIds.length) return false

    try {
      const owned = await this.permissionCache.getRolesPerms(roleIds)
      if (!owned.has(SENSITIVE_VIEW_PERM)) return false
      const tenantId = TenantContext.filterTenantId()
      if (tenantId !== null && tenantId > 0) {
        const packaged = await this.permissionCache.getTenantPerms(tenantId)
        return packaged.has(SENSITIVE_VIEW_PERM)
      }
      return true
    } catch {
      return false
    }
  }
}
