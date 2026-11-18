/**
 * 字典语义色单元测试（node:test，跑的是 dist 里编译后的实现）。
 *
 * 前置：先 `npm run build`。运行：`npm test`
 *
 * 守的三条底线：
 * 1. 导出 → 再导入必须闭环：导出的值（success 等）一定认得出，否则「导出来改两个字再导回」会丢色
 * 2. 中文写法要认（运营在 Excel 里会填「绿」「橙色」），且大小写/空格不敏感
 * 3. 空单元格不能算「清除」：老模板没有颜色列、或整列留空，绝不能把已有颜色冲掉
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { DICT_COLORS, normalizeDictColor } = require('../dist/modules/system/dict/dict.constants.js')

test('白名单自洽：每个语义色都能被自己识别（导出→导入闭环）', () => {
  for (const color of DICT_COLORS) {
    assert.equal(normalizeDictColor(color), color, `语义色 ${color} 认不出来`)
  }
})

test('中文与英文别名归一化', () => {
  const cases = {
    绿: 'success',
    绿色: 'success',
    GREEN: 'success',
    通过: 'success',
    橙: 'warning',
    黄色: 'warning',
    ' amber ': 'warning',
    红: 'danger',
    驳回: 'danger',
    red: 'danger',
    蓝: 'info',
    blue: 'info',
    紫: 'primary',
    purple: 'primary',
    灰: 'neutral',
    default: 'neutral'
  }
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(normalizeDictColor(input), expected, `「${input}」应归一化为 ${expected}`)
  }
})

test('明确清除只认「无 / 无色 / none」', () => {
  assert.equal(normalizeDictColor('无'), '')
  assert.equal(normalizeDictColor('无色'), '')
  assert.equal(normalizeDictColor('none'), '')
})

test('空值与认不出的写法返回 undefined（保持原值，不清色）', () => {
  assert.equal(normalizeDictColor(undefined), undefined)
  assert.equal(normalizeDictColor(''), undefined)
  assert.equal(normalizeDictColor('   '), undefined)
  assert.equal(normalizeDictColor('随便写的'), undefined)
  assert.equal(normalizeDictColor('bg-red-500'), undefined)
})
