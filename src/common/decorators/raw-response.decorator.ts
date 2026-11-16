import { SetMetadata } from '@nestjs/common'

/**
 * 跳过统一响应包装：控制器返回什么就原样输出什么
 *
 * 用于对外协议必须遵守第三方惯例的端点（如 OAuth2 的 /v1/open/token 要返回
 * access_token / token_type / expires_in，包一层 {code,result} 反而让人家的
 * 客户端库解析不了）。内部接口一律不要用 —— 统一包装是全站契约。
 */
export const RAW_RESPONSE_KEY = 'rawResponse'

export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true)
