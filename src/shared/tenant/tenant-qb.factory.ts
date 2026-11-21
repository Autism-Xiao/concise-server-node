import type { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm'

import { applyTenantScope } from './tenant-scope.util'

/**
 * 带租户隔离的 QueryBuilder 安全入口
 *
 * 为什么要这个工厂：TypeORM 没有 MyBatis-Plus 那种「解析 SQL 自动追加 AND tenant_id=?」
 * 的全局拦截器，隔离条件只能手动加到每个 QueryBuilder 上。手写查询漏调一次
 * applyTenantScope 就是一次跨租户越权，而且不会报错、很难在 review 里发现。
 *
 * 这个工厂把「创建 QB」和「注入租户条件」绑成一个动作：调用方拿到的 QB 已经带好条件，
 * 只要用它就没有「忘记加」的可能。新代码一律用本工厂，不要再直接 repository.createQueryBuilder()。
 *
 * 语义与 applyTenantScope 完全一致（同一函数实现）：
 * - null（平台视角）→ 不加条件
 * - 0           → 只看共享数据
 * - >0          → 本租户 ∪ 共享数据
 *
 * 注意：
 * 1. 只用于**读**查询（SELECT）。写路径要用 tenantWriteCondition，不能直接用本工厂。
 * 2. 工厂只注入主表别名条件；JOIN 进来的关联表如果也带 tenant_id，需自行补条件
 *    （通常关联表通过主表 id 关联，主表已隔离即可）。
 * 3. 幂等：工厂内部就调一次 applyTenantScope；不要在外面再调一遍（重复 AND 条件虽不改变
 *    结果，但会让 SQL 变脏且掩盖「到底加了几次」的事实）。
 */
export function createTenantQb<T extends ObjectLiteral>(repository: Repository<T>, alias: string): SelectQueryBuilder<T> {
  const qb = repository.createQueryBuilder(alias)
  return applyTenantScope(qb, alias)
}
