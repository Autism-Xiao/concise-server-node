/**
 * 字典项语义色 / 自定义色
 *
 * 为什么语义色仍是默认、自定义只认严格 HEX：
 * - 库里存 tailwind class 等于把亮色写死，暗色主题下对比度直接崩
 * - 开放任意字符串拼进 className 等于样式注入面，所以自定义只允许 #RRGGBB
 * - 语义色由前后端白名单同步，运营不用懂色值；要精确品牌色时再用取色器填 HEX
 *
 * 前端映射表在 concise-admin 的 `src/lib/dict-color.ts`，**两边必须同步**：
 * 后端加一个语义色、前端没加，界面上会静默退化成纯文本（不报错，但也不上色）。
 * HEX 不需要同步：前端直接解析色值并用 inline style 渲染。
 */
export const DICT_COLORS = ['primary', 'success', 'warning', 'danger', 'info', 'neutral'] as const

export type DictColor = (typeof DICT_COLORS)[number]

/** 合法自定义色：#RRGGBB 或 RRGGBB（不带 #），不接受 rgb()/tailwind class/颜色别名 */
const HEX_COLOR_PATTERN = /^#?([0-9a-fA-F]{6})$/

/** 把 HEX 统一成 #RRGGBB 大写；非 HEX 返回 null */
export function normalizeHexColor(text: string): string | null {
  const match = HEX_COLOR_PATTERN.exec(text.trim())
  return match ? `#${match[1].toUpperCase()}` : null
}

/** 是否合法字典色（语义名 / 合法 HEX / 空串清除） */
export function isDictColorValue(text: string): boolean {
  return text === '' || (DICT_COLORS as readonly string[]).includes(text) || normalizeHexColor(text) !== null
}

export const DICT_COLOR_MESSAGE = `颜色只能是 ${DICT_COLORS.join(' / ')} 之一、或 #RRGGBB 格式的自定义色；留空表示不套色`

/** 导入时运营爱填的中文/英文写法 → 语义色；认不出的返回 undefined（按未配色处理，不整行失败） */
const COLOR_ALIASES: Record<string, DictColor | ''> = {
  primary: 'primary',
  主色: 'primary',
  紫: 'primary',
  紫色: 'primary',
  purple: 'primary',
  violet: 'primary',
  indigo: 'primary',
  success: 'success',
  成功: 'success',
  通过: 'success',
  已通过: 'success',
  绿: 'success',
  绿色: 'success',
  green: 'success',
  emerald: 'success',
  warning: 'warning',
  警告: 'warning',
  待审核: 'warning',
  橙: 'warning',
  橙色: 'warning',
  黄: 'warning',
  黄色: 'warning',
  orange: 'warning',
  amber: 'warning',
  yellow: 'warning',
  danger: 'danger',
  危险: 'danger',
  错误: 'danger',
  驳回: 'danger',
  已驳回: 'danger',
  红: 'danger',
  红色: 'danger',
  red: 'danger',
  error: 'danger',
  info: 'info',
  信息: 'info',
  蓝: 'info',
  蓝色: 'info',
  blue: 'info',
  sky: 'info',
  neutral: 'neutral',
  中性: 'neutral',
  灰: 'neutral',
  灰色: 'neutral',
  默认: 'neutral',
  gray: 'neutral',
  grey: 'neutral',
  default: 'neutral',
  slate: 'neutral',
  // 明确表示「清除配色」的写法：返回空串，调用方据此把列置空。
  // 注意空单元格不算清除（否则老模板/留空列会把已有颜色冲掉），只能是这些显式词
  无: '',
  无色: '',
  none: ''
}

/**
 * 导入颜色单元格 → 语义色
 *
 * - undefined：没填 / 认不出 / 该列不存在 —— 调用方保持原值不变（新增则视为无颜色）
 * - ''：明确写了「无 / none」，调用方把 color 置空
 * - 其它：合法语义色
 */
export function normalizeDictColor(text?: string): string | null | undefined {
  if (text === undefined) return undefined
  const value = text.trim()
  if (!value) return undefined
  // HEX 优先：取色器填的 #RRGGBB / RRGGBB 统一存成 #RRGGBB，不走别名表
  const hex = normalizeHexColor(value)
  if (hex) return hex
  // 认不出的写法在这里天然是 undefined（Record 索引到了不存在的键），调用方按「保持原值」处理
  const alias: DictColor | '' | undefined = COLOR_ALIASES[value.toLowerCase()]
  return alias
}
