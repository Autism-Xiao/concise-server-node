/**
 * 租户作用域单元测试（node:test，跑的是 dist 里编译后的实现）。
 *
 * 前置：先 `npm run build`。运行：`npm test`
 *
 * 守的是多租户底座最容易回归的几条语义：
 * 1. 读范围含平台共享行（tenant_id = 0），租户视角是「本租户 ∪ 共享」；
 * 2. 写范围不含共享行，租户只能写自己的数据；
 * 3. 平台视角不加条件（null），既能读也能写任意租户；
 * 4. 不同请求上下文互不污染（AsyncLocalStorage）；
 * 5. 安全入口工厂 createTenantQb 在租户视角自动注入条件、平台视角不注入。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { TenantContext } = require('../dist/shared/tenant/tenant.context.js')
const { tenantCondition, tenantWriteCondition } = require('../dist/shared/tenant/tenant-scope.util.js')
const { createTenantQb } = require('../dist/shared/tenant/tenant-qb.factory.js')

test('平台视角（null）：读写都不加条件', () => {
  TenantContext.withTenant(null, () => {
    assert.equal(tenantCondition('t'), null)
    assert.equal(tenantWriteCondition('t.tenant_id'), null)
  })
})

test('共享视角（0）：只能读写 tenant_id = 0', () => {
  TenantContext.withTenant(0, () => {
    const read = tenantCondition('t')
    const write = tenantWriteCondition('t.tenant_id')
    assert.equal(read.clause, 't.tenant_id = 0')
    assert.equal(write.clause, 't.tenant_id = 0')
  })
})

test('租户视角（>0）：读含共享行，写只含本租户', () => {
  TenantContext.withTenant(42, () => {
    const read = tenantCondition('t')
    const write = tenantWriteCondition('t.tenant_id')
    assert.equal(read.clause, '(t.tenant_id = :__tenantId OR t.tenant_id = 0)')
    assert.deepEqual(read.params, { __tenantId: 42 })
    assert.equal(write.clause, 't.tenant_id = :__tenantId')
    assert.deepEqual(write.params, { __tenantId: 42 })
  })
})

test('不同请求上下文互不污染（AsyncLocalStorage）', () => {
  TenantContext.withTenant(1, () => {
    assert.deepEqual(tenantWriteCondition('t.tenant_id').params, { __tenantId: 1 })
    TenantContext.withTenant(2, () => {
      assert.deepEqual(tenantWriteCondition('t.tenant_id').params, { __tenantId: 2 })
    })
    assert.deepEqual(tenantWriteCondition('t.tenant_id').params, { __tenantId: 1 })
  })
  assert.equal(TenantContext.filterTenantId(), null)
})

/** 假 QB：只记录 andWhere 调用，足以验证工厂是否注入了租户条件 */
function fakeQb() {
  const calls = []
  return {
    calls,
    andWhere(clause, params) {
      calls.push({ clause, params })
      return this
    }
  }
}

/** 假 repository：createQueryBuilder 返回假 QB */
function fakeRepo(qb) {
  return { createQueryBuilder: (_alias) => qb }
}

test('createTenantQb：租户视角自动注入租户条件', () => {
  TenantContext.withTenant(7, () => {
    const qb = fakeQb()
    const result = createTenantQb(fakeRepo(qb), 'entity')
    assert.equal(result, qb, '工厂应返回同一个 QB 便于链式调用')
    assert.equal(qb.calls.length, 1, '租户视角应恰好注入一次条件')
    assert.equal(qb.calls[0].clause, '(entity.tenant_id = :__tenantId OR entity.tenant_id = 0)')
    assert.deepEqual(qb.calls[0].params, { __tenantId: 7 })
  })
})

test('createTenantQb：平台视角不注入任何条件', () => {
  TenantContext.withTenant(null, () => {
    const qb = fakeQb()
    createTenantQb(fakeRepo(qb), 'entity')
    assert.equal(qb.calls.length, 0, '平台视角不加租户条件')
  })
})

test('createTenantQb：共享视角只锁 tenant_id = 0', () => {
  TenantContext.withTenant(0, () => {
    const qb = fakeQb()
    createTenantQb(fakeRepo(qb), 'entity')
    assert.equal(qb.calls.length, 1)
    assert.equal(qb.calls[0].clause, 'entity.tenant_id = 0')
  })
})
