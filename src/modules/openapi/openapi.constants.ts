/**
 * 开放平台常量：scope 清单与事件清单
 *
 * scope 是应用能调哪些接口；事件是应用（或平台级 webhook）能收到什么通知。
 * 都用固定清单而不是自由字符串：对接方拿到的文档要稳定，乱起名字只会两边对不上。
 */

/** 应用授权范围清单（@ApiScope 用的值必须从这里出） */
export const APP_SCOPES = {
  'user:read': '读取用户信息',
  'user:write': '创建/更新用户',
  'file:read': '读取文件列表与元信息',
  'file:write': '上传/删除文件',
  'customer:read': '读取客户信息',
  'customer:write': '创建/更新客户'
} as const

export type AppScopeKey = keyof typeof APP_SCOPES

export const APP_SCOPE_KEYS = Object.keys(APP_SCOPES) as AppScopeKey[]

/** 可订阅事件清单（webhook.event 的合法值） */
export const WEBHOOK_EVENTS = {
  'user.created': '新用户创建',
  'user.updated': '用户信息变更',
  'user.deleted': '用户删除',
  'webhook.test': '连通性测试（管理端手动触发）'
} as const

export type WebhookEventKey = keyof typeof WEBHOOK_EVENTS

export const WEBHOOK_EVENT_KEYS = Object.keys(WEBHOOK_EVENTS) as WebhookEventKey[]

/** 令牌有效期（秒）：对机器令牌来说 2 小时足够短，泄露后的窗口期可控 */
export const APP_TOKEN_EXPIRES_IN = 7200

/** Webhook 投递重试序列（毫秒）：1s / 5s / 15s，共 4 次尝试 */
export const WEBHOOK_RETRY_DELAYS_MS = [1000, 5000, 15000]

/** 单次请求超时（毫秒）：回调方 5 秒内没响应就按失败算，别让派发方被拖住 */
export const WEBHOOK_TIMEOUT_MS = 5000
