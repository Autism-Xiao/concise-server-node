/**
 * 清理隔离测试租户及其级联数据（开发库专用）
 *
 * smoke-tenant-isolation / smoke-tenant-demo 等脚本会建一批「隔离测试租户」，
 * 它们是 del_flag=0 的正常租户，通用 cleanup-smoke-data.mjs 只删软删租户，
 * 所以这批会残留。本脚本按「name LIKE '隔离测试租户%' 且 owner_user_id IS NULL」
 * 精确命中，物理删除整条租户生命周期数据。
 *
 * 默认 dry-run（只统计不删），加 --apply 才真正执行。
 *
 * 用法：
 *   node scripts/cleanup-isolation-tenants.mjs                    # 预览
 *   node scripts/cleanup-isolation-tenants.mjs --apply            # 执行
 *
 * 环境变量：SMOKE_DB_HOST / SMOKE_DB_PORT / SMOKE_DB_USER / SMOKE_DB_PASSWORD / SMOKE_DB_NAME
 *
 * 安全边界：
 *   - 只删命名命中的测试租户；默认租户(id=1)、demo 租户、正式租户一律不动
 *   - 若任一目标租户下还有未删除用户（sys_user_tenant）或有用户 login_tenant_id 指向它，直接中止
 *   - 整个清理在一个事务里，出错全部回滚
 *   - 级联顺序对齐后端 TenantService.remove：先子后父
 */
import mysql from 'mysql2/promise'

const APPLY = process.argv.includes('--apply')

const conn = await mysql.createConnection({
  host: process.env.SMOKE_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.SMOKE_DB_PORT ?? 3306),
  user: process.env.SMOKE_DB_USER ?? 'root',
  password: process.env.SMOKE_DB_PASSWORD ?? '123456',
  database: process.env.SMOKE_DB_NAME ?? 'concise_server',
  charset: 'utf8mb4',
  multipleStatements: false
})

console.log(APPLY ? '=== 清理模式（会真正删除）===' : '=== 预览模式（不删任何数据，加 --apply 执行）===')

// 目标租户：命名前缀 + 无 owner（隔离测试脚本建的都没有归属用户），显式排除默认租户
const [tenants] = await conn.query(
  "SELECT id, name, code FROM sys_tenant WHERE name LIKE '隔离测试租户%' AND owner_user_id IS NULL AND id <> 1 ORDER BY id"
)
if (tenants.length === 0) {
  console.log('没有待清理的隔离测试租户。')
  await conn.end()
  process.exit(0)
}
const tenantIds = tenants.map(t => Number(t.id))
const ph = tenantIds.map(() => '?').join(',')

console.log(`\n命中 ${tenants.length} 个隔离测试租户：`)
for (const t of tenants) console.log(`  ${t.id}  ${t.name}  [${t.code}]`)

// 安全阀：任何目标租户下有真实成员 / 有用户以其为登录租户 → 中止，绝不删
const [members] = await conn.query(
  `SELECT ut.tenant_id, u.username, u.del_flag
     FROM sys_user_tenant ut JOIN sys_user u ON u.id = ut.user_id
    WHERE ut.tenant_id IN (${ph}) AND u.del_flag = 0`,
  tenantIds
)
const [loginUsers] = await conn.query(
  `SELECT id, username, login_tenant_id FROM sys_user WHERE login_tenant_id IN (${ph})`,
  tenantIds
)
if (members.length > 0 || loginUsers.length > 0) {
  console.error('\n中止：目标租户下仍有真实用户，拒绝清理。')
  if (members.length) console.error('  成员关系：', members)
  if (loginUsers.length) console.error('  登录租户指向：', loginUsers)
  await conn.end()
  process.exit(1)
}
console.log('\n安全阀通过：无真实用户关联。')

// 目标租户下的角色 id（级联用）
const [roleRows] = await conn.query(`SELECT id FROM sys_role WHERE tenant_id IN (${ph})`, tenantIds)
const roleIds = roleRows.map(r => r.id)
const rph = roleIds.map(() => '?').join(',')

/** 待清理项：按依赖顺序，先子后父（对齐 TenantService.remove 的级联） */
const steps = [
  { name: '角色的用户绑定', table: 'sys_user_role', where: roleIds.length ? `role_id IN (${rph})` : '1 = 0', params: roleIds },
  { name: '角色的权限授权', table: 'sys_role_permission', where: roleIds.length ? `role_id IN (${rph})` : '1 = 0', params: roleIds },
  { name: '租户私有角色', table: 'sys_role', where: `tenant_id IN (${ph})`, params: tenantIds },
  { name: '租户套餐菜单', table: 'sys_tenant_menu', where: `tenant_id IN (${ph})`, params: tenantIds },
  { name: '租户成员关系', table: 'sys_user_tenant', where: `tenant_id IN (${ph})`, params: tenantIds },
  { name: '租户操作日志', table: 'sys_log', where: `tenant_id IN (${ph})`, params: tenantIds },
  { name: '隔离测试租户本身', table: 'sys_tenant', where: `id IN (${ph})`, params: tenantIds }
]

console.log('\n待清理明细：')
const plan = []
for (const step of steps) {
  const [rows] = await conn.query(`SELECT COUNT(*) c FROM ${step.table} WHERE ${step.where}`, step.params)
  const hit = Number(rows[0]?.c ?? 0)
  plan.push({ ...step, hit })
  console.log(`  ${String(hit).padStart(6)}  ${step.name}`)
}

if (!APPLY) {
  console.log('\n预览结束。确认无误后执行：node scripts/cleanup-isolation-tenants.mjs --apply')
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
