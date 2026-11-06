/**
 * 页面水印文案渲染
 *
 * 为什么放在服务端：用户名、IP、时间必须由后端给，前端自己拼的话
 * 改一下 localStorage 就能把水印写成别人的名字，溯源价值归零。
 *
 * 渲染结果是「最终要绘制的文本行」，前端拿到后只做 canvas fillText，
 * 不再做任何字符串替换。
 */

/** 单条水印内容最大长度（模板写入上限） */
export const WATERMARK_CONTENT_MAX_LENGTH = 200

/** 单行最大长度：再长前端 canvas 的平铺区块就装不下，会被裁切 */
export const WATERMARK_LINE_MAX_LENGTH = 100

/** 最多渲染行数：超过 4 行在屏幕上会糊成一片 */
export const WATERMARK_MAX_LINES = 4

export interface WatermarkTemplateContext {
  username?: string | null
  nickname?: string | null
  dept?: string | null
  ip?: string | null
  userId?: string | null
  /** 仅测试用，默认取当前时间 */
  now?: Date
}

const PLACEHOLDER = /\{(username|nickname|dept|ip|userId|date|time)\}/g

const pad = (value: number): string => String(value).padStart(2, '0')

/** YYYY-MM-DD */
export function formatWatermarkDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** HH:mm */
export function formatWatermarkTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 把模板渲染成水印文本行
 *
 * - 空模板 → 兜底为登录账号（否则水印画出来是空白，等于没有）
 * - 未知占位符原样保留（写成 {foo} 就显示 {foo}，便于用户发现拼错）
 * - 换行符或 `|` 都视为换行（设置面板是单行输入框，用 | 更顺手）
 */
export function renderWatermarkLines(template: string | null | undefined, context: WatermarkTemplateContext): string[] {
  const fallback = (context.username ?? '').trim() || '未知用户'
  const raw = (template ?? '').trim()
  if (!raw) {
    return [fallback]
  }

  const now = context.now ?? new Date()
  const values: Record<string, string> = {
    username: context.username ?? '',
    nickname: context.nickname ?? '',
    dept: context.dept ?? '',
    ip: context.ip ?? '',
    userId: context.userId ?? '',
    date: formatWatermarkDate(now),
    time: formatWatermarkTime(now)
  }

  const lines = raw
    .replace(PLACEHOLDER, (_, key: string) => values[key] ?? '')
    .split(/\r?\n|\|/)
    .map(line =>
      line
        .replace(/[ \t]+/g, ' ')
        .trim()
        .slice(0, WATERMARK_LINE_MAX_LENGTH)
    )
    .filter(Boolean)
    .slice(0, WATERMARK_MAX_LINES)

  // 模板全是占位符但都解析为空（如只有 {dept} 且用户没部门）时同样兜底
  return lines.length ? lines : [fallback]
}

/** 校验并归一化用户/管理员提交的内容模板，返回可直接落库的字符串 */
export function normalizeWatermarkContent(content: string | null | undefined): string | null {
  if (content === null || content === undefined) {
    return null
  }
  return content.replace(/\r\n/g, '\n').trim().slice(0, WATERMARK_CONTENT_MAX_LENGTH)
}
