const test = require('node:test')
const assert = require('node:assert')

const { sanitize } = require('../dist/common/interceptors/oper-log.interceptor.js')

test('密码字段永远打码（与开关无关）', () => {
  const out = sanitize({ password: 'abc123', nested: { oldPassword: 'x' } }, false)
  assert.equal(out.password, '***')
  assert.equal(out.nested.oldPassword, '***')
})

test('开关关闭：敏感键与手机号原文落库（存量行为不变）', () => {
  const out = sanitize({ phone: '13812345678', amount: 999.5, note: '联系电话13812345678' }, false)
  assert.equal(out.phone, '13812345678')
  assert.equal(out.amount, 999.5)
  assert.equal(out.note, '联系电话13812345678')
})

test('开关开启：敏感键打码（手机号保留前3后4，其余整值 ***）', () => {
  const out = sanitize({ phone: '13812345678', amount: 999.5, cost: 'free-text', price: 0 }, true)
  assert.equal(out.phone, '138****5678')
  assert.equal(out.amount, '***')
  assert.equal(out.cost, '***')
  // price=0 是合法金额，同样打码（宁可多打不漏）
  assert.equal(out.price, '***')
})

test('开关开启：11 位手机号保留前3后4，非手机号整值 ***', () => {
  assert.equal(sanitize({ phone: '13812345678' }, true).phone, '138****5678')
  // 键名不带敏感词但值是手机号：仅字符串内嵌替换
  const out = sanitize({ remark: '回电 15912345678 谢谢' }, true)
  assert.equal(out.remark, '回电 159****5678 谢谢')
  // 恰好 11 位纯数字键名无关
  assert.equal(sanitize({ code: '13912345678' }, true).code, '139****5678')
})

test('开关开启：手机号打码不误伤普通数字与更长串', () => {
  const out = sanitize({ id: '138123456789012', qty: 13812345678, text: '编号 1381234567x' }, true)
  assert.equal(out.id, '138123456789012')
  assert.equal(out.qty, 13812345678)
  assert.equal(out.text, '编号 1381234567x')
})

test('开关开启：数组与空值处理正确', () => {
  const out = sanitize({ list: [{ phone: '13812345678' }, { phone: '' }, { phone: null }] }, true)
  assert.equal(out.list[0].phone, '138****5678')
  assert.equal(out.list[1].phone, '')
  assert.equal(out.list[2].phone, null)
})
