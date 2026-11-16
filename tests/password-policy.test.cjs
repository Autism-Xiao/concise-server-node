/**
 * 密码策略单元测试（node:test，跑的是 dist 里编译后的实现）。
 *
 * 为什么不用 jest：NestJS 12 的包是 ESM，jest 30 的运行时在 Node 22 上直接报
 * "Must use import to load ES Module"；而 `node --test` 走的是原生 require(esm)，能用。
 * 本仓库因此约定：单测一律 `tests/*.test.cjs`，断言用 node:assert。
 *
 * 前置：先 `npm run build`（测试 require 的是 dist，不是 src）。
 * 运行：`npm test`
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { assertPasswordStrength } = require('../dist/utils/password-policy.util.js')
const { BizErrorCode } = require('../dist/common/enums/biz-error-code.enum.js')

const POLICY = {
  minLength: 8,
  requireComplexity: true,
  expireDays: 90,
  forceChangeOnFirstLogin: false,
  maxFailCount: 5
}

/** 断言被拒，且拒绝原因是「参数非法 1001」而不是别的异常 */
function expectRejected(password, username) {
  assert.throws(
    () => assertPasswordStrength(password, POLICY, username),
    error => {
      assert.equal(error.bizCode, BizErrorCode.PARAM_INVALID, `"${password}" 的错误码应为 1001，实际 ${error.bizCode}`)
      return true
    },
    `"${password}" 应该被拒绝，但通过了`
  )
}

function expectAccepted(password, username) {
  assert.doesNotThrow(() => assertPasswordStrength(password, POLICY, username), `"${password}" 应该放行，但被拒绝了`)
}

test('长度：短于下限拒绝，刚好等于下限放行', () => {
  expectRejected('Ab1!x')
  expectAccepted('N7#vQm2L')
})

test('长度：超过 128 位拒绝', () => {
  expectRejected(`A1!${'x'.repeat(130)}`)
})

test('字符种类：纯小写 / 只有两类字符要拒绝', () => {
  expectRejected('abcdefgh')
  expectRejected('abcdefg1')
})

test('字符种类：四类齐全放行', () => {
  expectAccepted('N7#vQm2Lp')
})

test('字符种类：关掉复杂度开关后纯字母放行', () => {
  assert.doesNotThrow(() => assertPasswordStrength('vbnmkjhu', { ...POLICY, requireComplexity: false }))
})

test('空白：中间或尾部空格都要拒绝（防复制粘贴带入）', () => {
  expectRejected('N7# vQm2L')
  expectRejected('N7#vQm2L ')
})

test('弱模式：同一字符刷长度要拒绝', () => {
  expectRejected('aaaaaaaaA1')
})

test('弱模式：常见弱口令要拒绝（含「字母+数字」这类看着像密码的）', () => {
  expectRejected('Password1')
})

test('用户名：包含用户名（含大小写变体）要拒绝', () => {
  expectRejected('zhang3#kLm', 'zhang3')
  expectRejected('Zhang3#kLm', 'zhang3')
})

test('用户名：与用户名无关时放行', () => {
  expectAccepted('N7#vQm2Lp', 'zhang3')
})
