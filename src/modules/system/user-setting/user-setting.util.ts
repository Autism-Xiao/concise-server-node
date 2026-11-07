/**
 * 用户设置白名单（服务端权威）
 *
 * 前端 `lib/settings.ts` 的 AppSettings 有 8 个键，这里逐项做类型/值域校验，
 * 目的不是"拦住用户"，而是**不让任意 JSON 落库**：
 *  - 只认识的键才存（前端加新键要同步加到这里，否则会被静默丢弃）
 *  - 值不合法的键丢弃，其余照存（局部容错比整体 400 更适合偏好类数据）
 *  - themeColor 只校验格式不校验枚举：主题预设是前端资源，后端留出新增空间
 */

export const FONT_SIZES = ['small', 'default', 'large'] as const
export const SIDEBAR_VARIANTS = ['sidebar', 'floating', 'inset'] as const
export const LAYOUT_MODES = ['default', 'compact', 'offcanvas'] as const
export const DIRECTIONS = ['ltr', 'rtl'] as const

/** 设置 JSON 的体积上限（正常一条不到 200 字节，这里只防被当成存储桶） */
export const MAX_SETTINGS_BYTES = 4096

/** 主题色名：custom 或预设名（小写字母/数字/短横线） */
const THEME_COLOR_RE = /^(custom|[a-z][a-z0-9-]{0,31})$/
/** 自定义颜色 #rrggbb */
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i

export type UserSettings = Record<string, string | boolean>

const pickEnum = (value: unknown, allowed: readonly string[]): string | undefined => (typeof value === 'string' && allowed.includes(value) ? value : undefined)

/**
 * 按白名单裁剪，返回只含合法键值的新对象
 *
 * 注意：返回空对象是合法情况（用户什么都没传或全传错），
 * 调用方应把它当作"没有可更新字段"，而不是"清空设置"。
 */
export function normalizeSettings(input: unknown): UserSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const raw = input as Record<string, unknown>
  const result: UserSettings = {}

  const fontSize = pickEnum(raw.fontSize, FONT_SIZES)
  if (fontSize) result.fontSize = fontSize

  if (typeof raw.themeColor === 'string' && THEME_COLOR_RE.test(raw.themeColor)) {
    result.themeColor = raw.themeColor
  }

  if (typeof raw.customColor === 'string' && HEX_COLOR_RE.test(raw.customColor.trim())) {
    result.customColor = raw.customColor.trim().toLowerCase()
  }

  if (typeof raw.grayscale === 'boolean') result.grayscale = raw.grayscale
  if (typeof raw.colorWeak === 'boolean') result.colorWeak = raw.colorWeak

  const sidebarVariant = pickEnum(raw.sidebarVariant, SIDEBAR_VARIANTS)
  if (sidebarVariant) result.sidebarVariant = sidebarVariant

  const layout = pickEnum(raw.layout, LAYOUT_MODES)
  if (layout) result.layout = layout

  const direction = pickEnum(raw.direction, DIRECTIONS)
  if (direction) result.direction = direction

  return result
}

/** 序列化后的字节数（按 UTF-8 估算，用于体积上限判断） */
export function settingsSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? {}), 'utf8')
}
