import { formatDateTime, parseCsv, toCsv } from './csv.util'

describe('csv.util', () => {
  describe('toCsv / parseCsv 往返', () => {
    it('普通表头与数据行往返一致', () => {
      const headers = ['名称', '编码', '描述']
      const rows = [['运营专员', 'operator', '负责日常运营']]
      expect(parseCsv(toCsv(headers, rows))).toEqual([headers, ...rows])
    })

    it('含逗号、双引号、换行的单元格加引号后可还原', () => {
      const tricky = '含,逗号与"引号"以及\n换行'
      const parsed = parseCsv(toCsv(['值'], [[tricky]]))
      expect(parsed[1][0]).toBe(tricky)
    })

    it('null/undefined/数字单元格按空串或原值输出', () => {
      const csv = toCsv(['a', 'b', 'c'], [[null, undefined, 42]])
      const parsed = parseCsv(csv)
      expect(parsed[1]).toEqual(['', '', '42'])
    })

    it('解析时跳过空白行并兼容 CRLF 与 BOM', () => {
      const parsed = parseCsv('\uFEFFa,b\r\n1,2\r\n\r\n')
      expect(parsed).toEqual([
        ['a', 'b'],
        ['1', '2']
      ])
    })
  })

  describe('formatDateTime', () => {
    it('输出 YYYY-MM-DD HH:mm:ss 并补零', () => {
      expect(formatDateTime(new Date(2026, 10, 4, 9, 5, 3))).toBe('2026-11-04 09:05:03')
    })

    it('空值返回空串，非法日期原样返回', () => {
      expect(formatDateTime(null)).toBe('')
      expect(formatDateTime(undefined)).toBe('')
      expect(formatDateTime('')).toBe('')
      expect(formatDateTime('not-a-date')).toBe('not-a-date')
    })
  })
})
