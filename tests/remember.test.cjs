const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

// 前置：npm run build
const {
  REMEMBER_RECORD_PREFIX,
  REMEMBER_USER_INDEX_PREFIX,
  REMEMBER_FALLBACK_TTL,
  clampRememberDays,
  hashRememberToken,
  encodeRememberPayload,
  decodeRememberPayload
} = require('../dist/modules/auth/services/remember-me.util.js')

test('clampRememberDays：非法值落默认 7 天', () => {
  for (const days of [undefined, NaN, 0, -3, Number.NaN]) {
    assert.equal(clampRememberDays(days), 7)
  }
})

test('clampRememberDays：边界收敛（下限 1 / 上限 15），小数取整', () => {
  assert.equal(clampRememberDays(1), 1)
  assert.equal(clampRememberDays(15), 15)
  assert.equal(clampRememberDays(30), 15)
  assert.equal(clampRememberDays(7.9), 7)
})

test('hashRememberToken：等于 token 的 SHA-256 hex，确定性且不暴露原文', () => {
  const token = 'abc-XYZ-123'
  const expected = createHash('sha256').update(token).digest('hex')
  assert.equal(hashRememberToken(token), expected)
  assert.equal(hashRememberToken(token), hashRememberToken(token))
  assert.match(hashRememberToken(token), /^[0-9a-f]{64}$/)
  assert.ok(!hashRememberToken(token).includes(token))
})

test('encode/decodeRememberPayload：往返一致，deviceId 缺省补空串', () => {
  const payload = { userId: 'u1', deviceId: 'dev-9', refreshToken: 'rt-1' }
  const decoded = decodeRememberPayload(encodeRememberPayload(payload))
  assert.deepEqual(decoded, payload)
  assert.deepEqual(decodeRememberPayload(JSON.stringify({ userId: 'u1', refreshToken: 'rt-1' })), {
    userId: 'u1',
    deviceId: '',
    refreshToken: 'rt-1'
  })
})

test('decodeRememberPayload：脏数据 / 缺关键字段返回 null（由调用方删除记录）', () => {
  assert.equal(decodeRememberPayload('not-json{'), null)
  assert.equal(decodeRememberPayload('{}'), null)
  assert.equal(decodeRememberPayload(JSON.stringify({ userId: 'u1' })), null)
  assert.equal(decodeRememberPayload(JSON.stringify({ refreshToken: 'rt-1' })), null)
})

test('键前缀：记录键与用户索引键空间隔离，兜底 TTL 为 24h', () => {
  assert.ok(REMEMBER_RECORD_PREFIX.startsWith('remember:login:'))
  assert.ok(REMEMBER_USER_INDEX_PREFIX.startsWith('remember:login:'))
  assert.notEqual(REMEMBER_RECORD_PREFIX, REMEMBER_USER_INDEX_PREFIX)
  assert.equal(REMEMBER_FALLBACK_TTL, 24 * 60 * 60)
})
