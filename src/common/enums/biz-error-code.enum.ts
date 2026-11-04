/**
 * 业务错误码（响应体 code 字段）
 *
 * 约定：
 * - 0 表示成功，由 TransformInterceptor 统一返回
 * - 4xx 段沿用 HTTP 语义的数字（412/413/414/415/416/417），方便与 JeecgBoot 前端约定对齐
 * - 1xxx 段为本项目自定义业务码，避免与 HTTP 状态码混淆
 * - 前端判断成功只看 success 或 code === 0，不要用 HTTP 状态码
 */
export enum BizErrorCode {
  /** 验证码错误 */
  CAPTCHA_INVALID = 412,
  /** 验证码已过期 */
  CAPTCHA_EXPIRED = 413,
  /** 验证码不存在 */
  CAPTCHA_NOT_FOUND = 414,
  /** 验证码已被使用 */
  CAPTCHA_ALREADY_USED = 415,
  /** 验证码发送过于频繁 */
  CAPTCHA_SEND_TOO_FREQUENT = 416,
  /** 验证码参数错误 */
  CAPTCHA_PARAM_INVALID = 417,

  /** 参数校验失败 */
  PARAM_INVALID = 1001,
  /** 资源不存在 */
  NOT_FOUND = 1002,
  /** 未授权 */
  UNAUTHORIZED = 1003,
  /** 禁止访问 */
  FORBIDDEN = 1004,
  /** 业务处理失败 */
  BUSINESS_ERROR = 1005,
  /** 服务器内部错误 */
  INTERNAL_ERROR = 1006,

  /** 登录失败（用户名或密码错误）—— 本项目扩展 */
  LOGIN_FAILED = 1007,
  /** 账号已停用/冻结 —— 本项目扩展 */
  ACCOUNT_DISABLED = 1008,

  /** 依赖服务不可用（如 Redis 未启用导致验证码不可用），沿用原 503 保持兼容 */
  SERVICE_UNAVAILABLE = 503
}
