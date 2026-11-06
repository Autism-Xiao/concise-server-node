import { FALLBACK_WATERMARK_SETTING, resolveWatermarkState, type WatermarkSettingSnapshot } from './watermark.util'

const base: WatermarkSettingSnapshot = { ...FALLBACK_WATERMARK_SETTING }

describe('watermark.util resolveWatermarkState', () => {
  it('optional 且无自定义：继承全局开关', () => {
    expect(resolveWatermarkState({ ...base, enabled: 1 })).toMatchObject({ enabled: true, editable: true, reason: null })
    expect(resolveWatermarkState({ ...base, enabled: 0 })).toMatchObject({ enabled: false, editable: true })
  })

  it('用户显式关闭时不会被全局开关覆盖（0 不能被 ?? 吞掉）', () => {
    expect(resolveWatermarkState({ ...base, enabled: 1 }, { enabled: 0 })).toMatchObject({ enabled: false, editable: true })
  })

  it('mode=off 时全站关闭且用户不可编辑，优先级最高', () => {
    expect(resolveWatermarkState({ ...base, mode: 'off', enabled: 1 }, { enabled: 1, enforced: 1 })).toMatchObject({
      enabled: false,
      editable: false,
      reason: '管理员已关闭全站水印'
    })
  })

  it('用户被点名关闭（enforced=2）优先于全站强制', () => {
    expect(resolveWatermarkState({ ...base, mode: 'forced' }, { enforced: 2 })).toMatchObject({
      enabled: false,
      editable: false,
      reason: '管理员已关闭该账号的水印'
    })
  })

  it('用户被点名开启（enforced=1）时即便自己关过也强制显示', () => {
    expect(resolveWatermarkState({ ...base, enabled: 0 }, { enabled: 0, enforced: 1 })).toMatchObject({
      enabled: true,
      editable: false,
      reason: '管理员已强制开启该账号的水印'
    })
  })

  it('mode=forced 时所有未点名用户强制开启', () => {
    expect(resolveWatermarkState({ ...base, mode: 'forced' }, null)).toMatchObject({
      enabled: true,
      editable: false,
      reason: '管理员已强制开启全站水印'
    })
  })

  it('非法 mode 按 optional 处理，不会意外锁死用户', () => {
    expect(resolveWatermarkState({ ...base, mode: 'whatever' })).toMatchObject({ editable: true })
  })
})
