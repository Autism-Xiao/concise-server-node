/**
 * 租户管理员开通冒烟
 *
 * 覆盖：
 *   1. 平台管理员为指定租户建管理员账号（一步完成建号 + 加入租户 + 绑本租户 admin 角色）
 *   2. 新账号确实落在目标租户：sys_user_tenant / sys_user_role.tenant_id 都对
 *   3. 新账号能登录，拿到本租户的菜单与按钮权限，且没有平台级权限
 *   4. 新账号不能给自己绑别的租户的角色（400），也不能调平台级接口（403）
 *   5. 用户名重复、租户不存在、无 admin 角色时的报错可读
 *
 * 运行前提：
 *   1. 本机 MySQL（默认 127.0.0.1:3306 / root）可连，库 concise_server
 *   2. 有一个测试实例在跑：PORT=3461 CAPTCHA_ENABLED=false node dist/main.js
 *   3. admin / admin123 是平台管理员；租户 19（demo_sz）已初始化默认角色
 *
 * 用法：node scripts/smoke-tenant-admin.mjs
 */
import mysql from 'mysql2/promise'

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3461/api/v1'
const TAG = Date.now().toString(36)
const TARGET_TENANT = Number(process.env.SMOKE_TENANT ?? 19)
const USERNAME = `smoke_tadmin_${TAG}`
const PASSWORD = 'Tadm1n@2026'

/** 另一个租户的 admin 角色（租户 1 的），用来验证跨租户绑定会被拒 */
const FOREIGN_TENANT = TARGET_TENANT === 1 ? 19 : 1

let passed = 0
let failed = 0

function ok(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.log(`  ✗ ${name}${detail === undefined ? '' : ` —— ${JSON.stringify(detail)}`}`)
  }
}

async function api(path, { method = 'GET', token, tenantId, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (tenantId !== undefined) headers['X-Tenant-Id'] = String(tenantId)
  const response = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await response.json().catch(() => null)
  return { status: response.status, json }
}

const conn = await mysql.createConnection({
  host: process.env.SMOKE_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.SMOKE_DB_PORT ?? 3306),
  user: process.env.SMOKE_DB_USER ?? 'root',
  password: process.env.SMOKE_DB_PASSWORD ?? '123456',
  database: process.env.SMOKE_DB_NAME ?? 'concise_server',
  charset: 'utf8mb4'
})

let createdUserId = null

async function cleanup() {
  if (!createdUserId) return
  const [roles] = await conn.query('SELECT role_id FROM sys_user_role WHERE user_id = ?', [createdUserId])
  for (const row of roles) {
    await conn.query('DELETE FROM sys_user_role WHERE user_id = ? AND role_id = ?', [createdUserId, row.role_id])
  }
  await conn.query('DELETE FROM sys_user_setting WHERE user_id = ?', [createdUserId])
  await conn.query('DELETE FROM sys_user_tenant WHERE user_id = ?', [createdUserId])
  await conn.query('DELETE FROM sys_user WHERE id = ?', [createdUserId])
  createdUserId = null
}

try {
  const loginAdmin = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })
  ok('平台管理员登录成功', loginAdmin.json?.code === 0, loginAdmin.json?.message)
  const token = loginAdmin.json.result.accessToken

  const [adminRoleRows] = await conn.query("SELECT id FROM sys_role WHERE tenant_id = ? AND role_code = 'admin' LIMIT 1", [TARGET_TENANT])
  const targetAdminRoleId = adminRoleRows[0]?.id
  ok(`目标租户 ${TARGET_TENANT} 有内置 admin 角色`, Boolean(targetAdminRoleId))

  const [foreignRows] = await conn.query("SELECT id FROM sys_role WHERE tenant_id = ? AND role_code = 'admin' LIMIT 1", [FOREIGN_TENANT])
  const foreignAdminRoleId = foreignRows[0]?.id

  /* ---------------- 1. 开通管理员 ---------------- */
  console.log('\n[1] 为租户建管理员')
  const created = await api(`/tenants/${TARGET_TENANT}/admin`, {
    method: 'POST',
    token,
    body: { username: USERNAME, realname: `租户${TARGET_TENANT}管理员`, password: PASSWORD }
  })
  createdUserId = created.json?.result?.id ?? null
  ok('开通接口返回成功', created.status === 201 || created.status === 200, created.json?.message)
  ok('返回了新账号 id', Boolean(createdUserId), created.json?.message)
  ok('返回的角色是本租户 admin', created.json?.result?.roles?.some(role => role.roleCode === 'admin' && Number(role.tenantId) === TARGET_TENANT), created.json?.result?.roles)

  const [utRows] = await conn.query('SELECT tenant_id, status FROM sys_user_tenant WHERE user_id = ?', [createdUserId])
  ok('账号已加入目标租户', utRows.some(row => Number(row.tenant_id) === TARGET_TENANT && Number(row.status) === 0), JSON.stringify(utRows))

  const [urRows] = await conn.query('SELECT role_id, tenant_id FROM sys_user_role WHERE user_id = ?', [createdUserId])
  ok('角色关联写了角色归属租户', urRows.some(row => Number(row.tenant_id) === TARGET_TENANT), JSON.stringify(urRows))

  /* ---------------- 2. 新账号端到端 ---------------- */
  console.log('\n[2] 新管理员登录与权限')
  const asAdmin = await api('/auth/login', { method: 'POST', body: { username: USERNAME, password: PASSWORD } })
  ok('新管理员能登录', asAdmin.json?.code === 0, asAdmin.json?.message)
  const childToken = asAdmin.json?.result?.accessToken

  const perms = await api('/auth/permissions', { token: childToken, tenantId: TARGET_TENANT })
  const permList = perms.json?.result?.permissions ?? []
  ok('拿到菜单/按钮权限（非空）', permList.length > 0, `count=${permList.length}`)
  ok('有用户管理权限 system:user:list', permList.includes('system:user:list'), permList.slice(0, 5))
  ok('没有平台级权限 system:tenant:list', !permList.includes('system:tenant:list'))
  ok('菜单树非空', (perms.json?.result?.menus ?? []).length > 0)
  ok('菜单树里没有租户管理页', !JSON.stringify(perms.json?.result?.menus ?? []).includes('/system/tenant'))

  const dashboard = await api('/dashboard/overview', { token: childToken, tenantId: TARGET_TENANT })
  ok('首页概览可访问（200）', dashboard.status === 200 && dashboard.json?.code === 0, dashboard.json?.message)

  /* ---------------- 3. 越权防护 ---------------- */
  console.log('\n[3] 越权防护')
  const tenantList = await api('/tenants', { token: childToken, tenantId: TARGET_TENANT })
  ok('租户管理员调租户列表 → 403', tenantList.status === 403, `status=${tenantList.status} ${tenantList.json?.message ?? ''}`)

  if (foreignAdminRoleId) {
    const hijack = await api(`/users/${createdUserId}/roles`, {
      method: 'PUT',
      token: childToken,
      tenantId: TARGET_TENANT,
      body: { roleIds: [foreignAdminRoleId] }
    })
    ok('绑别的租户的 admin 角色 → 400', hijack.status === 400, `status=${hijack.status} ${hijack.json?.message ?? ''}`)
  }

  const selfPlatform = await api(`/users/${createdUserId}/platform-admin`, {
    method: 'PUT',
    token: childToken,
    tenantId: TARGET_TENANT,
    body: { enabled: true }
  })
  ok('给自己提平台管理员 → 403', selfPlatform.status === 403, `status=${selfPlatform.status} ${selfPlatform.json?.message ?? ''}`)

  /* ---------------- 4. 异常分支 ---------------- */
  console.log('\n[4] 异常分支')
  const dup = await api(`/tenants/${TARGET_TENANT}/admin`, {
    method: 'POST',
    token,
    body: { username: USERNAME, realname: '重复账号', password: PASSWORD }
  })
  ok('用户名重复 → 400', dup.status === 400, `status=${dup.status} ${dup.json?.message ?? ''}`)

  const ghost = await api('/tenants/999999/admin', {
    method: 'POST',
    token,
    body: { username: `smoke_ghost_${TAG}`, realname: '幽灵租户', password: PASSWORD }
  })
  ok('租户不存在 → 404/400', ghost.status === 404 || ghost.status === 400, `status=${ghost.status}`)

  const shortPwd = await api(`/tenants/${TARGET_TENANT}/admin`, {
    method: 'POST',
    token,
    body: { username: `smoke_short_${TAG}`, realname: '短密码', password: '123' }
  })
  ok('密码过短 → 400', shortPwd.status === 400, `status=${shortPwd.status}`)
} finally {
  await cleanup()
  await conn.end()
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
