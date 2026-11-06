import { envBoolean } from '../global/env'

/**
 * 旧版（无 /v1 前缀）路由开关
 *
 * 背景：项目从「无版本号」演进到 /v1 时，旧控制器没有删除，而是与 v1 并存，
 * 导致同一能力暴露两套路径（117 条 v1 + 40 条旧版），带来三个问题：
 *  1. 两套路由的 Swagger 文档重复，前端容易接错；
 *  2. 任何鉴权/限流策略调整都要改两遍，容易漏（历史上 @Public 就漏过一次）；
 *  3. 攻击面翻倍：旧路由如果少挂一个守卫就是绕过通道。
 *
 * 前端 concise-admin 已全量切到 /backend-api/v1/**（grep 无残留），
 * 因此默认关闭旧路由；仅当确实有老客户端/脚本依赖时，用 LEGACY_ROUTES_ENABLED=true 临时打开。
 *
 * 实现方式是「条件注册控制器」而不是删文件：
 *  - 关掉时 Nest 根本不注册这些路由，404 而不是 403，不会泄露「接口存在但没权限」；
 *  - 保留代码=保留迁移期间的排查参照，确定无人使用后再物理删除。
 */
export const LEGACY_ROUTES_ENABLED = envBoolean('LEGACY_ROUTES_ENABLED', false)
