/**
 * 清理冒烟/联调遗留数据（开发库专用）
 *
 * 冒烟脚本会在库里留下大量临时账号、租户、字典、公告、部门和日志。这个脚本按
 * 「命名前缀」把它们物理删掉，而不是软删 —— 软删会继续占用 username / code 唯一键，
 * 也会让回收站越堆越多。
 *
 * 默认 dry-run（只统计不删），加 --apply 才真正执行。
 *
 * 用法：
 *   node scripts/cleanup-smoke-data.mjs                      # 预览将要删除的内容
 *   node scripts/cleanup-smoke-data.mjs --apply              # 执行清理（不含日志）
 *   node scripts/cleanup-smoke-data.mjs --apply --with-logs  # 连日志一起清
 *
 * 环境变量：SMOKE_DB_HOST / SMOKE_DB_PORT / SMOKE_DB_USER / SMOKE_DB_PASSWORD / SMOKE_DB_NAME
 *
 * 安全边界：
 *   - 只删本文件 SMOKE_USER_PREFIXES / SMOKE_DICT_PREFIXES 等常量命中的行
 *   - 账号白名单（admin/jeecg/zhangsan/ceshi）永不删，命中会直接报错中止
 *   - 整个清理在一个事务里，出错全部回滚
 */
import mysql from 'mysql2/promise'

const APPLY = process.argv.includes('--apply')
const WITH_LOGS = process.argv.includes('--with-logs')

/** 冒烟脚本用的账号前缀（smk_/smoke_/iso_/iso2_/pf_/um_/um2_/tmp_probe_/locktest_/wm_del_） */
const SMOKE_USER_PREFIXES = ['smk_', 'smoke_', 'iso_', 'iso2_', 'pf_', 'um_', 'um2_', 'tmp_probe_', 'locktest_', 'wm_del_']
/** 早期手工联调账号，散落无前缀，单独列举 */
const SMOKE_USER_NAMES = ['permtest', 'crudtest', 'kimi_test', 'tester', 'wangwu', 'zs123']
/** 演示/正式账号白名单：任何情况下都不能被删掉 */
const PROTECTED_USERS = ['admin', 'jeecg', 'zhangsan', 'ceshi']

/** 冒烟字典：smoke_dict_* / bs_dict_* / test_dict */
const SMOKE_DICT_PREFIXES = ['smoke_dict_', 'bs_dict_']
const SMOKE_DICT_CODES = ['test_dict']

/** 冒烟公告标题前缀 */
const SMOKE_ANNOUNCE_PREFIXES = ['smoke_', 'bs_']

const conn = await mysql.createConnection({
  host: process.env.SMOKE_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.SMOKE_DB_PORT ?? 3306),
  user: process.env.SMOKE_DB_USER ?? 'root',
  password: process.env.SMOKE_DB_PASSWORD ?? '123456',
  database: process.env.SMOKE_DB_NAME ?? 'concise_server',
  charset: 'utf8mb4',
  multipleStatements: false
})

const likeClause = (column, prefixes) => prefixes.map(() => `${column} LIKE ?`).join(' OR ')
const inClause = values => values.map(() => '?').join(',')

// 冒烟账号的 WHERE 条件与参数，供各步骤复用（子查询里别名不同，单独生成列名）
const userWhere = alias => {
  const col = alias ? `${alias}.username` : 'username'
  const sql = `(${likeClause(col, SMOKE_USER_PREFIXES)} OR ${col} IN (${inClause(SMOKE_USER_NAMES)}))`
  const params = [...SMOKE_USER_PREFIXES.map(p => `${p}%`), ...SMOKE_USER_NAMES]
  return { sql, params }
}

const userFilter = userWhere('')

const junkUserIds = `SELECT id FROM sys_user WHERE ${userFilter.sql}`
const JUNK_USER_PARAMS = userFilter.params

const dictWhere = likeClause('dict_code', SMOKE_DICT_PREFIXES) + ` OR dict_code IN (${inClause(SMOKE_DICT_CODES)})`
const DICT_PARAMS = [...SMOKE_DICT_PREFIXES.map(p => `${p}%`), ...SMOKE_DICT_CODES]

const annWhere = likeClause('titile', SMOKE_ANNOUNCE_PREFIXES)
const ANN_PARAMS = SMOKE_ANNOUNCE_PREFIXES.map(p => `${p}%`)

/** 待清理项：name + 计数 SQL + 删除 SQL + 参数（按依赖顺序执行，先子后父） */
const STEPS = [
  {
    name: '冒烟账号的岗位关联',
    table: 'sys_user_post',
    where: `user_id IN (${junkUserIds})`,
    params: JUNK_USER_PARAMS
  },
  {
    name: '冒烟账号的部门关联',
    table: 'sys_user_depart',
    where: `user_id IN (${junkUserIds})`,
    params: JUNK_USER_PARAMS
  },
  {
    name: '冒烟账号的角色关联',
    table: 'sys_user_role',
    where: `user_id IN (${junkUserIds})`,
    params: JUNK_USER_PARAMS
  },
  {
    name: '冒烟账号的租户关联',
    table: 'sys_user_tenant',
    where: `user_id IN (${junkUserIds})`,
    params: JUNK_USER_PARAMS
  },
  {
    name: '冒烟账号的界面设置',
    table: 'sys_user_setting',
    where: `user_id IN (${junkUserIds})`,
    params: JUNK_USER_PARAMS
  },
  {
    name: '冒烟账号的水印设置',
    table: 'sys_user_watermark',
    where: `user_id IN (${junkUserIds})`,
    params: JUNK_USER_PARAMS
  },
  {
    name: '冒烟账号本身',
    table: 'sys_user',
    where: userFilter.sql,
    params: JUNK_USER_PARAMS
  },
  {
    name: '软删租户的角色授权',
    table: 'sys_role_permission',
    where: 'role_id IN (SELECT id FROM sys_role WHERE tenant_id IN (SELECT id FROM sys_tenant WHERE del_flag = 1))',
    params: []
  },
  {
    name: '软删租户下的角色',
    table: 'sys_role',
    where: 'tenant_id IN (SELECT id FROM sys_tenant WHERE del_flag = 1)',
    params: []
  },
  {
    name: '软删租户的用户关联',
    table: 'sys_user_tenant',
    where: 'tenant_id IN (SELECT id FROM sys_tenant WHERE del_flag = 1)',
    params: []
  },
  {
    name: '软删租户本身',
    table: 'sys_tenant',
    where: 'del_flag = 1',
    params: []
  },
  {
    // 历史遗留：早期 remove() 只软删租户、没删角色，留下 tenant_id 指向不存在租户的孤儿角色。
    // tenant_id = 0 是平台共享角色，必须保留，所以显式排除。
    name: '孤儿角色的授权（所属租户已不存在）',
    table: 'sys_role_permission',
    where: 'role_id IN (SELECT id FROM sys_role WHERE tenant_id <> 0 AND tenant_id NOT IN (SELECT id FROM sys_tenant))',
    params: []
  },
  {
    name: '孤儿角色（所属租户已不存在）',
    table: 'sys_role',
    where: 'tenant_id <> 0 AND tenant_id NOT IN (SELECT id FROM sys_tenant)',
    params: []
  },
  {
    name: '冒烟字典项',
    table: 'sys_dict_item',
    where: `dict_id IN (SELECT id FROM sys_dict WHERE ${dictWhere})`,
    params: DICT_PARAMS
  },
  {
    name: '冒烟字典',
    table: 'sys_dict',
    where: dictWhere,
    params: DICT_PARAMS
  },
  {
    name: '冒烟公告',
    table: 'sys_announcement',
    where: annWhere,
    params: ANN_PARAMS
  },
  {
    name: '软删的测试部门',
    table: 'sys_depart',
    where: 'del_flag = 1',
    params: []
  }
]

if (WITH_LOGS) {
  STEPS.push({ name: '登录/操作日志（全量）', table: 'sys_log', where: '1 = 1', params: [] })
}

console.log(APPLY ? '=== 清理模式（会真正删除）===' : '=== 预览模式（不删任何数据，加 --apply 执行）===')

// 白名单兜底：万一规则写宽了把演示账号圈进来，直接中止
const protectedWhere = `(${userFilter.sql}) AND username IN (${inClause(PROTECTED_USERS)})`
const [protectedRows] = await conn.query(`SELECT id, username FROM sys_user WHERE ${protectedWhere}`, [
  ...userFilter.params,
  ...PROTECTED_USERS
])
if (protectedRows.length > 0) {
  console.error('中止：保护账号命中删除条件，请修正脚本规则')
  console.error(protectedRows)
  await conn.end()
  process.exit(1)
}

const [junkUsers] = await conn.query(`SELECT id, username, is_platform_admin FROM sys_user WHERE ${userFilter.sql}`, userFilter.params)
console.log(`\n待删账号 ${junkUsers.length} 个（保留 ${PROTECTED_USERS.join(' / ')}）`)
const rogueAdmins = junkUsers.filter(u => Number(u.is_platform_admin) === 1)
if (rogueAdmins.length) {
  console.log(`  其中 ${rogueAdmins.length} 个被误标为平台管理员：${rogueAdmins.map(u => u.username).join(', ')}`)
}

const plan = []
for (const step of STEPS) {
  const [rows] = await conn.query(`SELECT COUNT(*) c FROM ${step.table} WHERE ${step.where}`, step.params)
  const hit = Number(rows[0]?.c ?? 0)
  plan.push({ ...step, hit })
  console.log(`  ${String(hit).padStart(6)}  ${step.name}`)
}

if (!APPLY) {
  console.log('\n预览结束。确认无误后执行：node scripts/cleanup-smoke-data.mjs --apply')
  await conn.end()
  process.exit(0)
}

console.log('\n开始清理…')
await conn.beginTransaction()
try {
  let touched = 0
  for (const step of plan) {
    const [res] = await conn.query(`DELETE FROM ${step.table} WHERE ${step.where}`, step.params)
    const rows = Number(res.affectedRows ?? 0)
    touched += rows
    console.log(`  已删 ${String(rows).padStart(6)} 行  ${step.name}`)
  }
  await conn.commit()
  console.log(`\n完成，共删除 ${touched} 行。`)
} catch (error) {
  await conn.rollback()
  console.error('\n清理失败，已回滚：', error.message)
  await conn.end()
  process.exit(1)
}

await conn.end()
