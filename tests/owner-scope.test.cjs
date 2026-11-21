/**
 * 业务数据 owner 级行权限单测（node:test，跑 dist 里编译后的实现）。
 * 前置：先 `npm run build`。运行：`npm test`
 *
 * 守的是：角色 data_scope 决定业务列表是否按 createBy 收窄——
 * 平台管理员 / 全部(1) 不限制；仅本人(4)/部门档(2,3) 按当前用户 id 过滤。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { needsOwnerScope, applyOwnerScope } = require('../dist/shared/permission/owner-scope.util.js')
const { BaseService } = require('../dist/helper/crud/base.service.js')

function fakeQb() {
  const calls = []
  return {
    calls,
    andWhere(clause, params) {
      calls.push({ clause, params })
      return this
    },
    async getOne() {
      return { id: 1 }
    }
  }
}

test('无 actor / 平台管理员：不受 owner 收窄', () => {
  assert.equal(needsOwnerScope(undefined), false)
  assert.equal(needsOwnerScope(null), false)
  assert.equal(needsOwnerScope({ id: 'u1', isPlatformAdmin: 1, roles: [{ dataScope: 4 }] }), false)
})

test('data_scope=全部(1)：不收窄', () => {
  assert.equal(needsOwnerScope({ id: 'u1', roles: [{ dataScope: 1 }] }), false)
})

test('data_scope=仅本人(4)：收窄', () => {
  assert.equal(needsOwnerScope({ id: 'u1', roles: [{ dataScope: 4 }] }), true)
})

test('部门档(2/3) 保守退化为仅本人：收窄', () => {
  assert.equal(needsOwnerScope({ id: 'u1', roles: [{ dataScope: 2 }] }), true)
  assert.equal(needsOwnerScope({ id: 'u1', roles: [{ dataScope: 3 }] }), true)
})

test('多角色取最小 data_scope：含全部(1) 则按最宽松放行', () => {
  // 与 user.service.applyDataScope 同口径：数值越小权限越大，取最小即取最大权限
  assert.equal(needsOwnerScope({ id: 'u1', roles: [{ dataScope: 1 }, { dataScope: 4 }] }), false)
})

test('多角色均受限（2 与 4）：取最小 2 → 收窄', () => {
  assert.equal(needsOwnerScope({ id: 'u1', roles: [{ dataScope: 2 }, { dataScope: 4 }] }), true)
})

test('无角色：不收窄（没有数据范围定义时不擅自限制）', () => {
  assert.equal(needsOwnerScope({ id: 'u1', roles: [] }), false)
})

test('applyOwnerScope：收窄时加 createBy = 当前用户，不收窄时不加条件', () => {
  const qb1 = fakeQb()
  applyOwnerScope(qb1, 'customer', { id: 'u1', roles: [{ dataScope: 4 }] })
  assert.equal(qb1.calls.length, 1)
  assert.equal(qb1.calls[0].clause, 'customer.createBy = :__ownerScopeId')
  assert.deepEqual(qb1.calls[0].params, { __ownerScopeId: 'u1' })

  const qb2 = fakeQb()
  applyOwnerScope(qb2, 'customer', { id: 'u1', roles: [{ dataScope: 1 }] })
  assert.equal(qb2.calls.length, 0)

  const qb3 = fakeQb()
  applyOwnerScope(qb3, 'order', { id: 'u2', roles: [{ dataScope: 4 }] }, 'ownerId')
  assert.equal(qb3.calls[0].clause, 'order.ownerId = :__ownerScopeId')
})

test('findOneScoped：详情/编辑入口复用 owner 收窄，且不影响基类 findOne', async () => {
  const qb = fakeQb()
  const repo = {
    metadata: { findColumnWithPropertyName: () => undefined },
    createQueryBuilder: () => qb
  }
  const service = new BaseService(repo, '测试')

  await service.findOneScoped(7, { id: 'u1', roles: [{ dataScope: 4 }] })
  const ownerCalls = qb.calls.filter(call => String(call.clause).includes('createBy'))
  assert.equal(ownerCalls.length, 1, '受限角色必须在按 id 单查上加 owner 条件')
  assert.equal(ownerCalls[0].params.__ownerScopeId, 'u1')
  assert.ok(
    qb.calls.some(call => call.clause === 'entity.id = :id'),
    '必须按 id 收窄'
  )

  qb.calls.length = 0
  await service.findOneScoped(7, { id: 'u1', roles: [{ dataScope: 1 }] })
  assert.equal(qb.calls.filter(call => String(call.clause).includes('createBy')).length, 0, 'ALL 角色不收窄')
})
