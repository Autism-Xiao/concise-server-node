import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * 请求级租户上下文（对齐 JeecgBoot 的 TenantContext ThreadLocal）
 *
 * 由 TenantMiddleware 在每个请求进入时写入，后续的 Guard / Interceptor / Service 都读同一份。
 * 用 AsyncLocalStorage 而不是全局变量：并发请求之间互不干扰。
 */
export interface TenantStore {
  /**
   * 当前生效的租户：
   * - `null` —— 不过滤（超级管理员且未指定租户，平台视角看全部）
   * - `0`    —— 只看平台共享数据（tenant_id = 0），无租户归属的账号走这里
   * - `> 0`  —— 该租户的数据 + 平台共享数据
   */
  tenantId: number | null
  /** 当前登录用户（公开接口没有） */
  userId?: string
  /** 是否超级管理员（admin / superadmin 角色） */
  isSuper: boolean
}

const storage = new AsyncLocalStorage<TenantStore>()

export const TenantContext = {
  /** 在给定上下文里执行（中间件用 `TenantContext.run(store, next)` 包住整个请求链） */
  run<T>(store: TenantStore, callback: () => T): T {
    return storage.run(store, callback)
  },

  get(): TenantStore | undefined {
    return storage.getStore()
  },

  /** 查询过滤用的租户 ID：null = 不过滤 */
  filterTenantId(): number | null {
    const store = storage.getStore()
    return store ? store.tenantId : null
  },

  /** 当前租户（用于写数据时打标）；null 表示不知道/不隔离 */
  currentTenantId(): number | null {
    return this.filterTenantId()
  },

  isSuper(): boolean {
    return storage.getStore()?.isSuper ?? false
  },

  userId(): string | undefined {
    return storage.getStore()?.userId
  },

  /** 手动构造一个上下文（脚本、定时任务、测试用） */
  withTenant<T>(tenantId: number | null, callback: () => T): T {
    return storage.run({ tenantId, isSuper: tenantId === null }, callback)
  }
}
