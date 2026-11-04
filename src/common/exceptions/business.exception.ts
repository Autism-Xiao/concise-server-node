import { HttpException, HttpStatus } from '@nestjs/common'

/**
 * 业务异常：HTTP 状态返回 200，通过响应体中的 code 区分错误。
 * 响应体为标准 Result：{ code: <bizCode>, message, result: null, success: false, timestamp }
 * 前端统一拦截：success === false（或 code !== 0）时提示 message。
 */
export class BusinessException extends HttpException {
  private readonly bizCode: number

  constructor(
    /** 业务错误信息，直接展示给用户 */
    message: string,
    /** 业务错误码，0 表示成功 */
    bizCode: number = HttpStatus.BAD_REQUEST
  ) {
    super({ message, code: bizCode }, HttpStatus.OK)
    this.bizCode = bizCode
  }

  getBizCode(): number {
    return this.bizCode
  }
}
