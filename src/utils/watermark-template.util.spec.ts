import { normalizeWatermarkContent, renderWatermarkLines } from './watermark-template.util'

const NOW = new Date(2026, 10, 6, 21, 59, 0)

describe('watermark-template.util', () => {
  describe('renderWatermarkLines', () => {
    it('空模板回退为登录账号', () => {
      expect(renderWatermarkLines('', { username: 'admin', now: NOW })).toEqual(['admin'])
      expect(renderWatermarkLines('   ', { username: 'admin', now: NOW })).toEqual(['admin'])
      expect(renderWatermarkLines(null, { username: 'admin', now: NOW })).toEqual(['admin'])
    })

    it('连账号都没有时兜底为「未知用户」，不会返回空数组', () => {
      expect(renderWatermarkLines('', { now: NOW })).toEqual(['未知用户'])
    })

    it('替换全部内置占位符', () => {
      const lines = renderWatermarkLines('{username} {nickname} {dept} {ip} {userId} {date} {time}', {
        username: 'zhangsan',
        nickname: '张三',
        dept: '研发部',
        ip: '10.0.0.8',
        userId: 'u1',
        now: NOW
      })
      expect(lines).toEqual(['zhangsan 张三 研发部 10.0.0.8 u1 2026-11-06 21:59'])
    })

    it('未知占位符原样保留，便于发现拼写错误', () => {
      expect(renderWatermarkLines('{foo} {username}', { username: 'admin', now: NOW })).toEqual(['{foo} admin'])
    })

    it('换行与竖线都拆成多行，并丢弃空行', () => {
      expect(renderWatermarkLines('第一行\n\n第二行|第三行', { username: 'admin', now: NOW })).toEqual(['第一行', '第二行', '第三行'])
    })

    it('单行超长时截断，总行数受上限约束', () => {
      const lines = renderWatermarkLines('a'.repeat(300) + '\n2\n3\n4\n5\n6', { username: 'admin', now: NOW })
      expect(lines).toHaveLength(4)
      expect(lines[0]).toHaveLength(100)
    })

    it('模板只有 {dept} 且用户无部门时回退账号名', () => {
      expect(renderWatermarkLines('{dept}', { username: 'lisi', dept: null, now: NOW })).toEqual(['lisi'])
    })

    it('压缩行内连续空白（占位符解析为空会留下双空格）', () => {
      expect(renderWatermarkLines('{username}  {dept}', { username: 'admin', dept: null, now: NOW })).toEqual(['admin'])
    })
  })

  describe('normalizeWatermarkContent', () => {
    it('未传内容时返回 null，表示继承全局', () => {
      expect(normalizeWatermarkContent(undefined)).toBeNull()
      expect(normalizeWatermarkContent(null)).toBeNull()
    })

    it('统一换行符并去除首尾空白', () => {
      expect(normalizeWatermarkContent('  {username}\r\n{date}  ')).toBe('{username}\n{date}')
    })

    it('超过 200 字符时截断', () => {
      expect(normalizeWatermarkContent('x'.repeat(260))).toHaveLength(200)
    })
  })
})
