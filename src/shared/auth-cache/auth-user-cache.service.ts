import { Injectable } from '@nestjs/common'

/**
 * 鉴权用户短缓存（进程内）
 *
 * 为什么单独抽一个服务而不是留在 JwtStrategy 里：
 * `validate` 是每个鉴权请求的热路径，必须缓存用户态（users + user_roles + roles 三表 join）；
 * 但缓存一旦写入，`is_platform_admin` / `status` / `roles` 的写路径就必须能**立刻失效**它，
 * 否则「取消平台管理员」在 30 秒内仍然有效 —— 降权不即时是安全问题。
 *
 * 缓存值刻意用 `unknown`：shared 层不反向依赖 modules 层，取用时由调用方断言类型。
 */
@Injectable()
export class AuthUserCacheService {
  private static readonly TTL_MS = 30_000
  private readonly store = new Map<string, { value: unknown; expiresAt: number }>()

  /** 命中返回缓存值（`null` 表示「查过但用户不存在」，同样有效），未命中返回 undefined */
  get<T>(userId: string): T | null | undefined {
    const entry = this.store.get(userId)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(userId)
      return undefined
    }
    return entry.value as T | null
  }

  set(userId: string, value: unknown): void {
    // 顺手清理：条目数明显超出常见在线量时扫一遍过期项，防长期驻留
    if (this.store.size > 2000) {
      const now = Date.now()
      for (const [key, entry] of this.store) {
        if (entry.expiresAt <= now) this.store.delete(key)
      }
    }
    this.store.set(userId, { value, expiresAt: Date.now() + AuthUserCacheService.TTL_MS })
  }

  /** 写路径主动失效：账号状态、角色绑定、平台管理员标记变更后必须调用 */
  invalidate(userId: string): void {
    this.store.delete(userId)
  }

  /** 全局失效：角色本身的权限/状态变化会影响所有持有该角色的人 */
  invalidateAll(): void {
    this.store.clear()
  }
}
