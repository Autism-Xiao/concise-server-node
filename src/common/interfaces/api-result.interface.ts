/**
 * 统一响应结构（对齐 JeecgBoot 的 Result<T>）
 *
 * 成功：{ code: 0, message: '', result: <业务数据>, success: true, timestamp: 1793768743245 }
 * 失败：{ code: <非 0>, message: '<可直接提示的文案>', result: null, success: false, timestamp: ... }
 *
 * - code 不是 HTTP 状态码：成功恒为 0；业务异常用业务码（如 503），参数/鉴权异常用 HTTP 状态码
 * - success 是冗余的快速判断位，等价于 code === 0，方便前端 `if (res.success)` 直接判断
 * - timestamp 由服务端在包装时生成（毫秒），用于排查前端缓存/时序问题
 */
export interface ApiResult<T = unknown> {
  /** 成功固定 0；失败为业务错误码或 HTTP 状态码 */
  code: number
  /** 成功为空串，失败为可直接展示的错误信息 */
  message: string
  /** 业务数据，失败时为 null */
  result: T | null
  /** 是否成功，等价于 code === 0 */
  success: boolean
  /** 服务端响应时间戳（毫秒） */
  timestamp: number
}

/** 兼容命名：部分脚手架/文档里叫 ApiResponse，与 ApiResult 完全等价 */
export type ApiResponse<T = unknown> = ApiResult<T>
