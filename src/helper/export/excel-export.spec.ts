import { buildExportSubtitle } from './excel-export'

/**
 * 导出副标题的格式被多个模块共用，前端/业务方都靠它判断这份文件是怎么导出来的，
 * 这里锁住三段式（时间/操作人/条数）+ 可选筛选段的拼接规则。
 */
describe('buildExportSubtitle', () => {
  it('拼接导出时间、操作人、条数与筛选条件', () => {
    const text = buildExportSubtitle({ operator: 'admin', count: 12, filters: ['关键字=张', '状态=正常'] })
    expect(text).toMatch(/^导出时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} · 操作人：admin · 共 12 条记录 · 筛选：关键字=张，状态=正常$/)
  })

  it('没有操作人时省略该段', () => {
    const text = buildExportSubtitle({ count: 0 })
    expect(text).toMatch(/^导出时间：.+ · 共 0 条记录$/)
    expect(text).not.toContain('操作人')
  })

  it('筛选条件里的空值被忽略，全空时不出筛选段', () => {
    const text = buildExportSubtitle({ count: 3, filters: ['', undefined, null] })
    expect(text).not.toContain('筛选')
  })
})
