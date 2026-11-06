/**
 * 数据库写入异常识别与翻译
 *
 * 为什么单独抽出来：唯一索引冲突（ER_DUP_ENTRY）在「创建用户 / 更新用户 / 导入」多条路径都会遇到，
 * 前置查重挡不住并发写，最终仍要靠捕获这个错误兜底——不能让用户看到
 * `QueryFailedError: Duplicate entry 'xxx' for key 'sys_user.uniq_sys_user_username'` 这种 500。
 */

/** 从异常里取出唯一键冲突信息；不是冲突返回 null */
export function parseDuplicateEntry(error: unknown): { value: string; key: string } | null {
  const raw = error instanceof Error ? error.message : ''
  const matched = /Duplicate entry '([^']*)' for key '([^']+)'/i.exec(raw)
  if (matched) {
    return { value: matched[1], key: matched[2] }
  }
  if ((error as { code?: string } | null)?.code === 'ER_DUP_ENTRY') {
    return { value: '', key: raw }
  }
  return null
}

/** 是否唯一键冲突 */
export function isDuplicateEntryError(error: unknown): boolean {
  return parseDuplicateEntry(error) !== null
}

/** 唯一键字段中文名（用于拼「手机号「138…」已被占用」这类提示） */
function labelOf(key: string, value: string): string {
  if (/phone/i.test(key) || /^1\d{10}$/.test(value)) return '手机号'
  if (/email/i.test(key) || value.includes('@')) return '邮箱'
  if (/work_?no/i.test(key)) return '工号'
  if (/username/i.test(key)) return '登录账号'
  return ''
}

/**
 * 把唯一键冲突翻译成中文提示
 * @param scope 作用域文案，默认「其他账号」；导入场景可传「其他账号」保持原样
 */
export function describeDuplicateEntry(error: unknown, scope = '其他账号'): string | null {
  const duplicated = parseDuplicateEntry(error)
  if (!duplicated) {
    return null
  }
  const { value, key } = duplicated
  const label = labelOf(key, value)
  if (!label) {
    return '数据与已有记录冲突（唯一约束），请检查手机号、邮箱、工号是否重复'
  }
  return label === '登录账号' ? `登录账号「${value}」已存在，请换一个` : `${label}「${value}」已被${scope}占用，请修改后再提交`
}
