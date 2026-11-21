import { SetMetadata } from '@nestjs/common'

/** 字段级查看权限码：菜单节点 perm_sensitive_view（租户模板 admin/editor 有，viewer 无） */
export const SENSITIVE_VIEW_PERM = 'data:sensitive:view'

/** 脱敏字段元数据 key */
export const SENSITIVE_KEY = 'sensitive_fields'

/**
 * 标记接口返回的敏感字段
 *
 * 无 SENSITIVE_VIEW_PERM 时，SensitiveInterceptor 会把这些字段**从响应中移除**，
 * 并附加 `maskedFields: string[]` 告诉前端「这里原本有值但你看不到」。
 * 刻意返回「移除」而不是「打码字符串」：前端编辑表单常用列表行回填，
 * 打码值会被原样 PUT 回后端覆盖真实数据；字段不存在则 Partial DTO 不会覆盖。
 */
export const Sensitive = (...fields: string[]) => SetMetadata(SENSITIVE_KEY, fields)
