/**
 * P1 冒烟：租户配额 / 用量计量 / 字段级脱敏
 *
 * 覆盖：
 *   1. maxUsers 设为「当前人数+1」后，第 1 个用户可建、第 2 个被 400 拒绝，恢复配置后不受限
 *   2. 带租户上下文的 API 调用会计入 sys_tenant_usage（api.calls）
 *   3. 平台管理员可读客户 phone；viewer（无 data:sensitive:view）读不到，且带 maskedFields 标记
 *   4. viewer 编辑客户时不带 phone 保存，不会把真实号码覆盖成空
 *
 * 运行前提：MySQL 可连、测试实例 PORT=3461 CAPTCHA_ENABLED=false，且已执行 migration:run。
 * 用法：SMOKE_BASE=http://127.0.0.1:3461/api/v1 node scripts/smoke-p1.mjs
 */
import mysql from 'mysql2/promise'
import { randomUUID } from 'node:crypto'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3461/api/v1'
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'admin123'
const TENANT = Number(process.env.SMOKE_TENANT ?? 1)
const TAG = Date.now().toString(36)
const NEW_PASSWORD = 'Sm0ke@P12026'

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

const createdUserIds = []
const createdCustomerId = { value: null }
const createdRoleId = { value: null }
let quotaRestored = false
let adminToken = null

async function cleanup() {
  for (const id of createdUserIds) {
    await conn.query('DELETE FROM sys_user_role WHERE user_id = ?', [id])
    await conn.query('DELETE FROM sys_user_tenant WHERE user_id = ?', [id])
    await conn.query('DELETE FROM sys_user_setting WHERE user_id = ?', [id])
    await conn.query('DELETE FROM sys_user WHERE id = ?', [id])
  }
  if (createdRoleId.value) {
    await conn.query('DELETE FROM sys_role_permission WHERE role_id = ?', [createdRoleId.value])
    await conn.query('DELETE FROM sys_role WHERE id = ?', [createdRoleId.value])
  }
  if (createdCustomerId.value) {
    await conn.query('DELETE FROM customer WHERE id = ?', [createdCustomerId.value])
  }
  if (!quotaRestored && adminToken) {
    await api('/configs', { method: 'PUT', token: adminToken, body: { configKey: 'tenant.quota.maxUsers', configValue: '0' } })
  }
  await conn.end()
}

try {
  const login = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: ADMIN_PASSWORD } })
  ok('平台管理员登录', login.json?.code === 0, login.json?.message)
  adminToken = login.json.result.accessToken

  /* ---------------- 1. 租户 Seats 配额 ---------------- */
  console.log('\n[1] 租户用户数配额')
  const [countRows] = await conn.query(
    `SELECT COUNT(*) AS c FROM sys_user_tenant ut INNER JOIN sys_user u ON u.id = ut.user_id AND u.del_flag = 0 WHERE ut.tenant_id = ? AND ut.status = 0`,
    [TENANT]
  )
  const before = Number(countRows[0]?.c ?? 0)
  const limit = before + 1
  const setQuota = await api('/configs', { method: 'PUT', token: adminToken, body: { configKey: 'tenant.quota.maxUsers', configValue: String(limit) } })
  ok('设置租户用户数上限', setQuota.json?.code === 0, setQuota.json?.message)

  const userBody = index => ({
    username: `smoke_p1_${TAG}_${index}`,
    realname: `P1配额${index}`,
    password: NEW_PASSWORD
  })
  const first = await api('/users', { method: 'POST', token: adminToken, tenantId: TENANT, body: userBody(1) })
  if (first.json?.result?.id) createdUserIds.push(first.json.result.id)
  ok(`上限内可建号（${before}/${limit}）`, first.status === 201 || first.status === 200, first.json?.message)
  const second = await api('/users', { method: 'POST', token: adminToken, tenantId: TENANT, body: userBody(2) })
  if (second.json?.result?.id) createdUserIds.push(second.json.result.id)
  ok('超限被 400 拒绝且文案说明上限', second.status === 400 && /上限/.test(second.json?.message ?? ''), second.json)

  const reset = await api('/configs', { method: 'PUT', token: adminToken, body: { configKey: 'tenant.quota.maxUsers', configValue: '0' } })
  quotaRestored = reset.json?.code === 0
  ok('恢复配置为不限制', quotaRestored, reset.json?.message)
  const afterReset = await api('/users', { method: 'POST', token: adminToken, tenantId: TENANT, body: userBody(3) })
  if (afterReset.json?.result?.id) createdUserIds.push(afterReset.json.result.id)
  ok('恢复后又能建号', afterReset.status === 201 || afterReset.status === 200, afterReset.json?.message)

  /* ---------------- 2. 用量计量 ---------------- */
  console.log('\n[2] 租户用量计量')
  const usage = await api('/metering/usage', { token: adminToken, tenantId: TENANT })
  ok('用量接口可访问', usage.json?.code === 0, usage.json?.message)
  const calls = Number(usage.json?.result?.metrics?.['api.calls'] ?? 0)
  ok('api.calls 已累计（查询前自动落盘）', calls > 0, usage.json?.result)
  const [usageRows] = await conn.query('SELECT metric, value FROM sys_tenant_usage WHERE tenant_id = ?', [TENANT])
  ok(
    'sys_tenant_usage 有落库行',
    usageRows.some(row => row.metric === 'api.calls' && Number(row.value) > 0),
    usageRows
  )

  /* ---------------- 3. 字段级脱敏 ---------------- */
  console.log('\n[3] 敏感字段脱敏')
  // 新权限点补进存量租户的角色（幂等）
  const provision = await api('/tenants/provision-all', { method: 'POST', token: adminToken })
  ok('provision-all 补权限点', provision.status === 200 || provision.status === 201, provision.json?.message)

  const phone = `139${String(Date.now()).slice(-8)}`
  const customer = await api('/customers', {
    method: 'POST',
    token: adminToken,
    tenantId: TENANT,
    body: { name: `P1客户${TAG}`, phone }
  })
  createdCustomerId.value = customer.json?.result?.id ?? null
  ok('创建带手机号的客户', Boolean(createdCustomerId.value), customer.json?.message)

  const asAdmin = await api(`/customers?keyword=${TAG}`, { token: adminToken, tenantId: TENANT })
  ok('平台管理员可读原文', asAdmin.json?.result?.records?.[0]?.phone === phone, asAdmin.json?.result?.records?.[0])

  const [viewerRows] = await conn.query("SELECT id FROM sys_role WHERE tenant_id = ? AND role_code = 'viewer' AND status = 1 LIMIT 1", [TENANT])
  const viewerRoleId = viewerRows[0]?.id
  ok('目标租户有 viewer 角色', Boolean(viewerRoleId))
  const [sensitiveRows] = await conn.query("SELECT permission_id FROM sys_role_permission WHERE role_id = ? AND permission_id = 'perm_sensitive_view'", [
    viewerRoleId ?? ''
  ])
  ok('viewer 未被授予 data:sensitive:view', sensitiveRows.length === 0, sensitiveRows)

  const viewerName = `smoke_p1_viewer_${TAG}`
  const viewer = await api('/users', {
    method: 'POST',
    token: adminToken,
    tenantId: TENANT,
    body: { username: viewerName, realname: 'P1只读', password: NEW_PASSWORD }
  })
  const viewerId = viewer.json?.result?.id
  if (viewerId) createdUserIds.push(viewerId)
  ok('创建 viewer 测试账号', Boolean(viewerId), viewer.json?.message)
  if (viewerId && viewerRoleId) {
    await conn.query('INSERT IGNORE INTO sys_user_role (user_id, role_id, tenant_id) VALUES (?, ?, ?)', [viewerId, viewerRoleId, TENANT])
  }

  const viewerLogin = await api('/auth/login', { method: 'POST', tenantId: TENANT, body: { username: viewerName, password: NEW_PASSWORD } })
  ok('viewer 能登录', viewerLogin.json?.code === 0, viewerLogin.json?.message)
  const viewerToken = viewerLogin.json?.result?.accessToken

  const asViewer = await api(`/customers?keyword=${TAG}`, { token: viewerToken, tenantId: TENANT })
  ok('viewer 可读列表', asViewer.json?.code === 0, asViewer.json?.message)
  const viewerRecord = asViewer.json?.result?.records?.[0]
  ok('viewer 响应里没有 phone 字段', viewerRecord && !Object.prototype.hasOwnProperty.call(viewerRecord, 'phone'), viewerRecord)
  ok('viewer 响应标记了 maskedFields=phone', viewerRecord?.maskedFields?.includes('phone') === true, viewerRecord?.maskedFields)

  // 造一个「能编辑客户但没有敏感字段查看权」的角色：viewer 本身没有 customer:update，
  // 用它测编辑会 403，验证不到「打码值被写回」这个真实风险。
  const roleId = randomUUID().replace(/-/g, '')
  createdRoleId.value = roleId
  const [permRows] = await conn.query("SELECT id FROM sys_permission WHERE perms IN ('customer:list', 'customer:update')")
  ok('找到 customer 列表/编辑权限点', permRows.length === 2, permRows)
  await conn.query(
    'INSERT INTO sys_role (id, role_name, role_code, data_scope, create_time, tenant_id, is_builtin, status) VALUES (?, ?, ?, 1, NOW(), ?, 0, 1)',
    [roleId, `P1编辑${TAG}`, `smoke_p1_editor_${TAG}`, TENANT]
  )
  for (const row of permRows) {
    await conn.query('INSERT INTO sys_role_permission (id, role_id, permission_id, operate_date) VALUES (?, ?, ?, NOW())', [
      randomUUID().replace(/-/g, ''),
      roleId,
      row.id
    ])
  }

  const editorName = `smoke_p1_editor_${TAG}`
  const editor = await api('/users', {
    method: 'POST',
    token: adminToken,
    tenantId: TENANT,
    body: { username: editorName, realname: 'P1编辑', password: NEW_PASSWORD }
  })
  const editorId = editor.json?.result?.id
  if (editorId) createdUserIds.push(editorId)
  ok('创建无敏感权限的编辑账号', Boolean(editorId), editor.json?.message)
  if (editorId) {
    await conn.query('INSERT IGNORE INTO sys_user_role (user_id, role_id, tenant_id) VALUES (?, ?, ?)', [editorId, roleId, TENANT])
  }

  const editorLogin = await api('/auth/login', { method: 'POST', tenantId: TENANT, body: { username: editorName, password: NEW_PASSWORD } })
  const editorToken = editorLogin.json?.result?.accessToken
  ok('编辑账号能登录并有 customer:update', await api('/customers', { token: editorToken, tenantId: TENANT }).then(r => r.json?.code === 0))
  const asEditor = await api(`/customers?keyword=${TAG}`, { token: editorToken, tenantId: TENANT })
  const editorRecord = asEditor.json?.result?.records?.[0]
  ok('编辑角色读列表时 phone 也被移除', editorRecord && !Object.prototype.hasOwnProperty.call(editorRecord, 'phone'), editorRecord)

  if (editorRecord) {
    const edited = await api(`/customers/${editorRecord.id}`, {
      method: 'PUT',
      token: editorToken,
      tenantId: TENANT,
      body: { name: `P1客户改${TAG}` }
    })
    ok('不带 phone 的编辑请求成功', edited.json?.code === 0, edited.json?.message)
    const adminCheck = await api(`/customers/${editorRecord.id}`, { token: adminToken, tenantId: TENANT })
    ok('编辑未把真实号码覆盖成空', adminCheck.json?.result?.phone === phone, adminCheck.json?.result?.phone)
  }

  console.log(`\n通过 ${passed} / 失败 ${failed}`)
  if (failed > 0) process.exitCode = 1
} finally {
  await cleanup()
}
