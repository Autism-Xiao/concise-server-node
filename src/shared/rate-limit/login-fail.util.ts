/**
 * 登录失败计数的 Redis key（账号维度，大小写不敏感）
 *
 * AuthService（登录时计数/校验/清零）与 UserService（管理员解锁）共用，
 * 两处各自拼字符串迟早对不上，抽成唯一出口。
 */
export function loginFailKeyOf(username: string): string {
  return `auth:login:fail:${String(username ?? '')
    .trim()
    .toLowerCase()}`
}
