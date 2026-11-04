import { HttpException, HttpStatus } from '@nestjs/common'

import { BizErrorCode } from '../enums/biz-error-code.enum'

/**
 * 业务异常：带业务错误码，由 AllExceptionsFilter 统一组装成标准 Result。
 *
 * 为什么默认 HTTP 200 而不是 400：
 * 本项目的约定是「业务失败也走 HTTP 200，用 code 区分」，前端 axios 不会进 catch 分支，
 * 统一在 then 里按 success / code 处理，避免「同一个错误弹两个提示」。
 * 确实需要非 200 语义的（如登录失败想保留 401、账号停用用 403），显式传第三个参数即可。
 *
 * 用法：
 * ```ts
 * throw new BizException(BizErrorCode.CAPTCHA_INVALID, '验证码错误')
 * throw new BizException(BizErrorCode.LOGIN_FAILED, '用户名或密码错误', HttpStatus.UNAUTHORIZED)
 * ```
 */
export class BizException extends HttpException {
  constructor(
    public readonly bizCode: BizErrorCode,
    message: string,
    httpStatus: HttpStatus = HttpStatus.OK
  ) {
    // 这里把结构先塞进 response，过滤器可直接 exception.getResponse() 复用（也可只用 bizCode）
    super({ success: false, code: bizCode, message, result: null }, httpStatus)
  }

  getBizCode(): BizErrorCode {
    return this.bizCode
  }
}
