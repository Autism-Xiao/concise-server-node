/**
 * 字段级变更采集器（进程内单例）
 *
 * 为什么用"注册槽"而不是 DI：
 * 采集点埋在 `BaseService.update()` 里，而 BaseService 被十几个业务 Service 继承、
 * 子类都是 `super(repo, '用户')` 这样简单调用。往基类构造函数塞一个可选依赖，
 * 要么所有子类都得改，要么 Nest 的注入在可选参数上报错。所以改成：
 * 基类只调用这个纯函数，真正的落库实现由日志模块在 `onModuleInit` 里注册进来。
 *
 * 没注册（比如某些脚本、单测直接 new Service）时是空操作，不会因为"没人收"而报错。
 */

export interface ChangeItem {
  /** 物理表名（来自实体元数据，不手写） */
  table: string
  recordId: string
  /** 属性名（如 realname），不是列名 */
  field: string
  /** 中文名（取自实体列 comment），给前端展示用 */
  label?: string
  oldValue: string
  newValue: string
}

export type ChangeSink = (items: ChangeItem[]) => void

let sink: ChangeSink | null = null

/** 日志模块启动时注册；传 null 可注销（测试用） */
export function registerChangeSink(next: ChangeSink | null): void {
  sink = next
}

/**
 * 敏感字段黑名单：命中就不记。
 * 宁可漏记也不能把密码/密钥/令牌写进审计表 —— 那张表的查询权限比用户表宽得多。
 */
const SENSITIVE_FIELD = /passw|salt|secret|token|credential|codehash|privatekey/i

/** 纯噪音字段：每次更新都会被自动改写，记了只会把真实改动淹没 */
const NOISY_FIELDS = new Set(['updateTime', 'updatedAt', 'updateBy'])

/** 单字段值上限：text 列放得下，但前端展开看不了几千字 */
const MAX_VALUE_LENGTH = 500

export function isSensitiveField(field: string): boolean {
  return SENSITIVE_FIELD.test(field)
}

export function shouldSkipField(field: string): boolean {
  return NOISY_FIELDS.has(field) || isSensitiveField(field)
}

/** 统一成可比较的字符串：Date → ISO，对象 → JSON，null/undefined → 空串 */
export function toComparable(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return clip(value)
  if (typeof value === 'object') {
    try {
      return clip(JSON.stringify(value))
    } catch {
      return clip(String(value))
    }
  }
  return clip(String(value))
}

function clip(text: string): string {
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text
}

/** 交给已注册的 sink；任何异常都吞掉——审计失败绝不能影响业务写入 */
export function emitChanges(items: ChangeItem[]): void {
  if (!sink || items.length === 0) return
  try {
    sink(items)
  } catch {
    // 有意静默：调用方是业务写路径，不能被审计拖下水
  }
}
