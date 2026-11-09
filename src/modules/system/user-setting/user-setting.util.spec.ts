import { DEFAULT_USER_SETTINGS, MAX_SETTINGS_BYTES, normalizeSettings, settingsSize, stripDefaultSettings, withDefaults } from './user-setting.util'

describe('user-setting.util withDefaults', () => {
  it('默认值本身必须全部通过白名单（防止加了默认键却忘了加校验）', () => {
    expect(normalizeSettings(DEFAULT_USER_SETTINGS)).toEqual(DEFAULT_USER_SETTINGS)
  })

  it('没有任何自定义时下发完整默认值', () => {
    expect(withDefaults(null)).toEqual(DEFAULT_USER_SETTINGS)
    expect(withDefaults({})).toEqual(DEFAULT_USER_SETTINGS)
    expect(withDefaults('脏数据')).toEqual(DEFAULT_USER_SETTINGS)
  })

  it('用户差异优先，缺失项用默认值补齐', () => {
    const result = withDefaults({ fontSize: 'large', themeColor: 'mint' })
    expect(result).toEqual({ ...DEFAULT_USER_SETTINGS, fontSize: 'large', themeColor: 'mint' })
    expect(result.grayscale).toBe(false)
  })

  it('未经裁剪的原始 JSON 也不会把未知键 / 非法值带出去', () => {
    const result = withDefaults({ fontSize: 'huge', evil: '<script>', direction: 'rtl' })
    expect(result).toEqual({ ...DEFAULT_USER_SETTINGS, direction: 'rtl' })
    expect(result.fontSize).toBe('default')
  })
})

describe('user-setting.util stripDefaultSettings', () => {
  it('全是默认值时落库为空（前端整包推送不会固化默认值）', () => {
    expect(stripDefaultSettings({ ...DEFAULT_USER_SETTINGS })).toEqual({})
  })

  it('只保留与默认值不同的键', () => {
    expect(stripDefaultSettings({ ...DEFAULT_USER_SETTINGS, fontSize: 'large', grayscale: true })).toEqual({ fontSize: 'large', grayscale: true })
  })

  it('用户把某项改回默认值时等价于删除该差异', () => {
    expect(stripDefaultSettings({ themeColor: 'default' })).toEqual({})
  })

  it('空对象不报错', () => {
    expect(stripDefaultSettings({})).toEqual({})
  })
})

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
