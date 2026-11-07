import { MAX_SETTINGS_BYTES, normalizeSettings, settingsSize } from './user-setting.util'

describe('user-setting.util normalizeSettings', () => {
  it('合法设置原样保留', () => {
    const input = {
      fontSize: 'large',
      themeColor: 'mint',
      customColor: '#FF8800',
      grayscale: true,
      colorWeak: false,
      sidebarVariant: 'inset',
      layout: 'compact',
      direction: 'rtl'
    }
    expect(normalizeSettings(input)).toEqual({
      fontSize: 'large',
      themeColor: 'mint',
      customColor: '#ff8800',
      grayscale: true,
      colorWeak: false,
      sidebarVariant: 'inset',
      layout: 'compact',
      direction: 'rtl'
    })
  })

  it('未知键被丢弃（不让任意 JSON 落库）', () => {
    expect(normalizeSettings({ fontSize: 'small', evil: '<script>', __proto__: { polluted: true } })).toEqual({ fontSize: 'small' })
  })

  it('值不合法的键单独丢弃，其余照存', () => {
    expect(normalizeSettings({ fontSize: 'huge', themeColor: 'Mint!', customColor: 'red', grayscale: 'yes', layout: 'compact' })).toEqual({ layout: 'compact' })
  })

  it('themeColor 允许 custom 与带短横线的预设名', () => {
    expect(normalizeSettings({ themeColor: 'custom' })).toEqual({ themeColor: 'custom' })
    expect(normalizeSettings({ themeColor: 'rose-gold' })).toEqual({ themeColor: 'rose-gold' })
  })

  it('非对象输入返回空对象（不会 500）', () => {
    expect(normalizeSettings(null)).toEqual({})
    expect(normalizeSettings('x')).toEqual({})
    expect(normalizeSettings([1, 2])).toEqual({})
  })
})

describe('user-setting.util settingsSize', () => {
  it('正常设置远小于上限', () => {
    expect(settingsSize({ fontSize: 'default', themeColor: 'mint' })).toBeLessThan(MAX_SETTINGS_BYTES)
  })

  it('超长字符串能被识别为超限', () => {
    expect(settingsSize({ themeColor: 'a'.repeat(MAX_SETTINGS_BYTES) })).toBeGreaterThan(MAX_SETTINGS_BYTES)
  })
})
