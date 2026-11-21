const test = require('node:test')
const assert = require('node:assert/strict')

// 前置：npm run build
const { buildRateLimitKey, RATE_LIMIT_KEY_PREFIX } = require('../dist/common/guards/rate-limit-key.js')

const base = { route: 'POST /v1/files', ip: '10.0.0.8' }

test('默认按 IP：key 含路由与 IP，不含租户段', () => {
  assert.equal(buildRateLimitKey(base), `${RATE_LIMIT_KEY_PREFIX}POST /v1/files:10.0.0.8`)
  assert.equal(buildRateLimitKey({ ...base, tenantId: 12 }), `${RATE_LIMIT_KEY_PREFIX}POST /v1/files:10.0.0.8`)
})

test('by=tenant 且有真实租户：同租户不同 IP 共用一个桶', () => {
  const a = buildRateLimitKey({ ...base, by: 'tenant', tenantId: 12 })
  const b = buildRateLimitKey({ ...base, by: 'tenant', tenantId: 12, ip: '10.9.9.9' })
  assert.equal(a, `${RATE_LIMIT_KEY_PREFIX}POST /v1/files:t12`)
  assert.equal(a, b)
})

test('by=tenant 但匿名/平台视角：回退 IP，避免全站共用一个桶', () => {
  for (const tenantId of [null, 0, undefined]) {
    assert.equal(buildRateLimitKey({ ...base, by: 'tenant', tenantId }), `${RATE_LIMIT_KEY_PREFIX}POST /v1/files:10.0.0.8`)
  }
})

test('by=tenant 与 by=ip 的 key 不冲突（租户段带 t 前缀）', () => {
  assert.notEqual(buildRateLimitKey({ ...base, by: 'tenant', tenantId: 12 }), buildRateLimitKey({ ...base, ip: '12' }))
})

test('by=account：账号 trim + 小写，仍保留 IP 前缀', () => {
  assert.equal(buildRateLimitKey({ ...base, by: 'account', account: '  Admin  ' }), `${RATE_LIMIT_KEY_PREFIX}POST /v1/files:10.0.0.8:admin`)
  assert.equal(buildRateLimitKey({ ...base, by: 'account' }), `${RATE_LIMIT_KEY_PREFIX}POST /v1/files:10.0.0.8`)
})

test('IP 缺省时落 unknown，路由为空也不产生 undefined 字符串', () => {
  assert.equal(buildRateLimitKey({ route: '', ip: '' }), `${RATE_LIMIT_KEY_PREFIX}:unknown`)
  assert.equal(buildRateLimitKey({ ...base, tenantId: 12, by: 'tenant', ip: '' }), `${RATE_LIMIT_KEY_PREFIX}POST /v1/files:t12`)
})
