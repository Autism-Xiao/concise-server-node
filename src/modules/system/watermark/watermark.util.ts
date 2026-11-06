/**
 * 水印生效规则
 *
 * 唯一真相在这里：接口下发、用户列表摘要、前端可编辑态判定都必须走 resolveWatermarkState，
 * 任何地方都不要再自己拼一套 if/else——两套规则迟早会分叉，然后出现「列表显示开、页面没水印」。
 */

export const WATERMARK_MODES = ['optional', 'forced', 'off'] as const
export type WatermarkMode = (typeof WATERMARK_MODES)[number]

export const WATERMARK_DENSITIES = ['compact', 'default', 'loose'] as const
export type WatermarkDensity = (typeof WATERMARK_DENSITIES)[number]

/** 水印样式参数：只允许全局配置修改，用户无权覆盖（否则把 opacity 调成 0 就等于关掉了水印） */
export interface WatermarkSettingSnapshot {
  enabled: number
  mode: string
  content: string
  density: string
  opacity: number
  rotate: number
  fontSize: number
}

/** 用户级覆盖：三处 NULL 表示继承全局 */
export interface WatermarkUserSnapshot {
  enabled?: number | null
  enforced?: number | null
  content?: string | null
  density?: string | null
}

export interface WatermarkState {
  /** 最终是否应该显示水印 */
  enabled: boolean
  /** 用户能否自己改（false 时前端把开关置灰并展示 reason） */
  editable: boolean
  /** editable=false 的原因，直接展示给用户 */
  reason: string | null
  mode: WatermarkMode
  enforced: number
}

/** 数据库无配置行时的兜底（与迁移里的初始值保持一致） */
export const FALLBACK_WATERMARK_SETTING: WatermarkSettingSnapshot = {
  enabled: 1,
  mode: 'optional',
  content: '{username}\n{date} {time}',
  density: 'default',
  opacity: 8,
  rotate: -22,
  fontSize: 14
}

/** tinyint / boolean 统一转布尔 */
export function toWatermarkFlag(value: number | boolean | null | undefined, fallback: boolean): boolean {
  if (value === null || value === undefined) {
    return fallback
  }
  return typeof value === 'boolean' ? value : Number(value) === 1
}

/**
 * 生效优先级（自上而下，命中即返回）：
 * 1. mode=off            → 全站关闭（用户改不了）
 * 2. 用户 enforced=2      → 点名关闭（用户改不了）
 * 3. 用户 enforced=1      → 点名开启（用户改不了）
 * 4. mode=forced         → 全站强制（用户改不了）
 * 5. 用户 enabled ?? 全局 enabled
 */
export function resolveWatermarkState(setting: WatermarkSettingSnapshot, custom?: WatermarkUserSnapshot | null): WatermarkState {
  const mode = (WATERMARK_MODES as readonly string[]).includes(setting.mode) ? (setting.mode as WatermarkMode) : 'optional'
  const enforced = Number(custom?.enforced ?? 0)

  if (mode === 'off') {
    return { enabled: false, editable: false, reason: '管理员已关闭全站水印', mode, enforced }
  }
  if (enforced === 2) {
    return { enabled: false, editable: false, reason: '管理员已关闭该账号的水印', mode, enforced }
  }
  if (enforced === 1) {
    return { enabled: true, editable: false, reason: '管理员已强制开启该账号的水印', mode, enforced }
  }
  if (mode === 'forced') {
    return { enabled: true, editable: false, reason: '管理员已强制开启全站水印', mode, enforced }
  }
  return { enabled: toWatermarkFlag(custom?.enabled ?? setting.enabled, true), editable: true, reason: null, mode, enforced }
}
