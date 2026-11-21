/**
 * 排序白名单单元测试（node:test，跑 dist 里编译后的实现）。
 * 前置：先 `npm run build`。运行：`npm test`
 *
 * 回归点：sortBy 传 '__proto__' / 'constructor' / 'toString' 时，
 * 普通对象直接索引会命中 Object.prototype 上的成员，拼出非法排序列让列表接口 500。
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { applySort, normalizeSortOrder } = require('../dist/helper/paginate/sort.js')

/** 假 QB：记录 orderBy / addOrderBy 调用 */
function fakeQb() {
  const order = []
  return {
    order,
    orderBy(expr, dir) {
      order.push({ expr, dir, additive: false })
      return this
    },
    addOrderBy(expr, dir) {
      order.push({ expr, dir, additive: true })
      return this
    }
  }
}

const allow = { name: 'realname', createdAt: 'create_time' }

test('合法字段：命中白名单并补 id 兜底', () => {
  const qb = fakeQb()
  const changed = applySort(qb, 'u', { sortBy: 'name', sortOrder: 'DESC' }, allow)
  assert.equal(changed, true)
  assert.deepEqual(qb.order, [
    { expr: 'u.realname', dir: 'DESC', additive: false },
    { expr: 'u.id', dir: 'DESC', additive: true }
  ])
})

test('主键字段：不重复补 id 兜底', () => {
  const qb = fakeQb()
  applySort(qb, 'u', { sortBy: 'id' }, { id: 'id' })
  assert.equal(qb.order.length, 1)
  assert.equal(qb.order[0].expr, 'u.id')
})

test('未知字段：不改写排序', () => {
  const qb = fakeQb()
  assert.equal(applySort(qb, 'u', { sortBy: 'unknown' }, allow), false)
  assert.equal(qb.order.length, 0)
})

for (const attack of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
  test(`原型链字段 ${attack}：不改写排序（不过滤会 500）`, () => {
    const qb = fakeQb()
    assert.equal(applySort(qb, 'u', { sortBy: attack }, allow), false, `${attack} 不应命中白名单`)
    assert.equal(qb.order.length, 0, `${attack} 不应产生任何排序表达式`)
  })
}

test('sortBy 为空 / 方向归一化', () => {
  const qb = fakeQb()
  assert.equal(applySort(qb, 'u', {}, allow), false)
  assert.equal(normalizeSortOrder('ASC'), 'asc')
  assert.equal(normalizeSortOrder('DESC'), 'desc')
  assert.equal(normalizeSortOrder('; DROP'), undefined)
})
