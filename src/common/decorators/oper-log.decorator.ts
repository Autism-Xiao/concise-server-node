import { SetMetadata } from '@nestjs/common'

/** 操作日志模块标识的 metadata key */
export const OPER_LOG_KEY = 'oper_log_module'

/**
 * 声明接口的操作日志模块名（如 '用户管理'）
 * 配合全局 OperLogInterceptor 使用：写操作（POST/PUT/DELETE/PATCH）自动落库
 * 不声明时回退为 Controller 类名去掉 Controller 后缀
 */
export const OperLog = (module: string) => SetMetadata(OPER_LOG_KEY, module)
