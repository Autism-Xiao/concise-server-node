/**
 * 用户关键字搜索的匹配策略
 *
 * 背景（docs/2026-11-09-千万级用户性能评估.md 实测）：`LIKE '%kw%'` 在 1000 万行上 > 120 秒，
 * 前缀不确定时 B+ 树只能全扫；改成 `LIKE 'kw%'` 才能用上索引。
 *
 * 前缀模式下还要**按字符集把三列 OR 拆开**，这一点是 100 万行实测出来的：
 *   `username OR realname OR phone` 三列前缀 OR → 优化器放弃 index_merge，
 *   改走 `(del_flag, create_time)` 顺序扫描逐行过滤，关键字不命中时就是 3.4 秒（等于全表扫）；
 *   而 `username OR phone` 两列 OR → 0.3 ms，`realname` 单列 → 0.1 ms。
 * 所以：
 *   ASCII 关键字（账号/手机号只可能是 ASCII）→ 只查 username + phone
 *   含中文的关键字（username 正则 `^[A-Za-z]...` 禁止中文）→ 只查 realname
 *
 * 代价：英文姓名（realname='John'）用 ASCII 关键字搜不到，需要改搜账号，
 * 或临时 `USER_SEARCH_MODE=contains` 回退到三列包含匹配（慢，仅排障用）。
 */
export type UserSearchMode = 'prefix' | 'contains'

/** 当前搜索模式（环境变量只认 'contains'，其余一律按前缀，避免配错就退化成全表扫） */
export function resolveUserSearchMode(): UserSearchMode {
  return (process.env.USER_SEARCH_MODE ?? '').trim().toLowerCase() === 'contains' ? 'contains' : 'prefix'
}

/** 关键字是否只含 ASCII（用户名正则只允许 ASCII，手机号是纯数字，中文只可能出现在真实姓名里） */
function isAsciiOnly(keyword: string): boolean {
  return /^[\x20-\x7e]*$/.test(keyword)
}

/**
 * keyword 的 WHERE 片段（参数名固定为 keyword，值见 userKeywordParam）
 *
 * 列表、导出、回收站共用这一个出口，保证三处搜索口径一致。
 */
export function userKeywordClause(alias: string, keyword: string): string {
  if (resolveUserSearchMode() === 'contains') {
    return `(${alias}.username LIKE :keyword OR ${alias}.realname LIKE :keyword OR ${alias}.phone LIKE :keyword)`
  }
  const columns = isAsciiOnly(keyword) ? ['username', 'phone'] : ['realname']
  return `(${columns.map(column => `${alias}.${column} LIKE :keyword`).join(' OR ')})`
}

/**
 * keyword 对应的参数值（已转义 LIKE 通配符）
 *
 * 不转义的话，用户输入 `_` 或 `%` 会退化成任意匹配 —— 既慢（全表扫），
 * 又会把不该出现的账号带出来。MySQL 的 LIKE 默认以 `\` 为转义符，无需再写 ESCAPE。
 */
export function userKeywordParam(keyword: string, mode: UserSearchMode = resolveUserSearchMode()): string {
  const escaped = keyword.replace(/[\\%_]/g, char => `\\${char}`)
  return mode === 'contains' ? `%${escaped}%` : `${escaped}%`
}
