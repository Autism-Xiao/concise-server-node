/**
 * 字典项语义色
 *
 * 为什么是语义色而不是 tailwind class：
 * - 库里存 class 等于把亮色写死，暗色主题下对比度直接崩
 * - 运营在字典管理页 / Excel 里要会背 tailwind 语法才能改色，代价太高
 * - 开放任意字符串拼进 className 等于样式注入面
 *
 * 前端映射表在 concise-admin 的 `src/lib/dict-color.ts`，**两边必须同步**：
 * 后端加一个色值、前端没加，界面上会静默退化成纯文本（不报错，但也不上色）。
 */
export const DICT_COLORS = ['primary', 'success', 'warning', 'danger', 'info', 'neutral'] as const

export type DictColor = (typeof DICT_COLORS)[number]

export const DICT_COLOR_MESSAGE = `颜色只能是 ${DICT_COLORS.join(' / ')} 之一，留空表示不套色`

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
export function normalizeDictColor(text?: string): DictColor | '' | undefined {
  if (text === undefined) return undefined
  const value = text.trim().toLowerCase()
  if (!value) return undefined
  // 认不出的写法在这里天然是 undefined（Record 索引到了不存在的键），调用方按「保持原值」处理
  const alias: DictColor | '' | undefined = COLOR_ALIASES[value]
  return alias
}
