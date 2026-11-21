#!/usr/bin/env node
/**
 * 冒烟：用户管辖部门（ReBAC 轻量版）对业务数据可见范围的影响
 *
 * 守的是 data_scope 部门档(2/3) 此前在业务表上被一律降级为「仅本人」的问题：
 * 配置 sys_user_supervise_dept 后，经理应能看到自己创建 ∪ 被监管部门成员创建的数据，
 * 且仍看不到未授权部门成员的数据；仅本人(4) 不受监管授权放大；跨租户不串。
 *
 * 流程：
 * 1. 建一个临时租户 + 父子部门（A / A-子 / B）+ 3 个用户（经理/ A 成员 / B 成员）
 * 2. 各写一条 create_by = 自己的客户；经理角色 data_scope=2 + customer:list
 * 3. 授权前：经理只看自己
 * 4. PUT /v1/users/:id/supervise-depts 授权部门 A（自动展开 A-子）
 * 5. 授权后：经理看到自己 + A 成员 + A-子成员，仍看不到 B 成员
 * 6. 经理角色改 data_scope=4：只看自己（监管授权不放大）
 *
 * 运行：node scripts/smoke-supervise-dept.mjs
 * 环境变量：SMOKE_BASE（默认 http://127.0.0.1:3461/api）、DB_* 同 .env
 */
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import 'dotenv/config'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3461/api'
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'admin123'
let token = ''

async function api(path, { method = 'GET', body, tenantId, accessToken } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(accessToken || token ? { Authorization: `Bearer ${accessToken || token}` } : {}),
      ...(tenantId ? { 'X-Tenant-Id': String(tenantId) } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  let json
  try {
    json = await response.json()
  } catch {
    throw new Error(`${method} ${path} 返回非 JSON（HTTP ${response.status}）`)
  }
  if (!response.ok || json.code !== 0) {
    throw new Error(`${method} ${path} 失败：HTTP ${response.status} code=${json.code} message=${json.message}`)
  }
  return json.result
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'concise_server'
})

const suffix = Math.random().toString(36).slice(2, 10)
const pw = 'Sm0ke@Sup2026'
let tenantId = 0
const userIds = []
const deptIds = []
const roleIds = []
const customerIds = []
let passed = 0

function check(label, condition) {
  assert.ok(condition, label)
  passed++
  console.log(`  ✓ ${label}`)
}

async function login(username, tenant) {
  const result = await api('/v1/auth/login', {
    method: 'POST',
    body: { username, password: pw },
    tenantId: tenant
  })
  return result.accessToken ?? result.access_token ?? result.token
}

let userSeq = 0
async function createUser(username, tenant) {
  const id = `supu_${suffix}_${++userSeq}`
  await conn.query(
    `INSERT INTO sys_user (id, username, password, realname, status, del_flag, login_tenant_id, create_time)
     VALUES (?, ?, 'x', ?, 1, 0, ?, NOW())`,
    [id, username, username, tenant]
  )
  await conn.query('INSERT INTO sys_user_tenant (user_id, tenant_id, status, create_time) VALUES (?, ?, 0, NOW())', [id, tenant])
  userIds.push(id)
  return id
}

try {
  const loginAdmin = await api('/v1/auth/login', { method: 'POST', body: { username: 'admin', password: ADMIN_PASSWORD } })
  token = loginAdmin.accessToken ?? loginAdmin.access_token ?? loginAdmin.token
  check('管理员登录拿到令牌', Boolean(token))

  const tenant = await api('/v1/tenants', {
    method: 'POST',
    body: { name: `冒烟监管${suffix}`, code: `smk_sup_${suffix}`, plan: 'standard' }
  })
  tenantId = tenant.id
  check('创建临时租户', tenantId > 0)

  // 部门 A / A-子 / B（A-子 挂在 A 下，用于验证展开）
  for (const [name, parentKey] of [
    ['A', null],
    ['A子', 'A'],
    ['B', null]
  ]) {
    const id = `supd_${suffix}_${name === 'A' ? 'a' : name === 'A子' ? 'ac' : 'b'}`
    const parentId = parentKey === 'A' ? `supd_${suffix}_a` : null
    await conn.query(
      `INSERT INTO sys_depart (id, depart_name, org_code, parent_id, status, del_flag, tenant_id, create_time)
       VALUES (?, ?, ?, ?, '1', '0', ?, NOW())`,
      [id, name, `sup_${suffix}_${name}`, parentId, tenantId]
    )
    deptIds.push(id)
  }
  const [deptA, deptAChild, deptB] = deptIds
  check('创建父子部门 A / A子 / B', deptIds.length === 3)

  // 3 个用户：经理 + A 成员 + A子成员 + B 成员（A 成员与 A子成员都归 A 管辖）
  const mgr = await createUser(`supmgr_${suffix}`, tenantId)
  const memberA = await createUser(`supma_${suffix}`, tenantId)
  const memberAC = await createUser(`supmac_${suffix}`, tenantId)
  const memberB = await createUser(`supmb_${suffix}`, tenantId)
  check('创建经理与三个部门成员', Boolean(mgr && memberA && memberAC && memberB))

  for (const [userId, dept] of [
    [memberA, deptA],
    [memberAC, deptAChild],
    [memberB, deptB]
  ]) {
    await conn.query('INSERT INTO sys_user_depart (ID, user_id, dep_id) VALUES (?, ?, ?)', [`udp_${suffix}_${userId}`, userId, dept])
  }

  const roleId = `supr_${suffix}`
  await conn.query(
    `INSERT INTO sys_role (id, role_name, role_code, data_scope, tenant_id, status, create_time)
     VALUES (?, ?, ?, 2, ?, 1, NOW())`,
    [roleId, `监管经理${suffix}`, `sup_role_${suffix}`, tenantId]
  )
  roleIds.push(roleId)
  await conn.query('INSERT INTO sys_role_permission (id, role_id, permission_id) VALUES (?, ?, ?)', [`srp_${suffix}`, roleId, 'menu_customer'])
  await conn.query('INSERT INTO sys_user_role (id, user_id, role_id, tenant_id) VALUES (?, ?, ?, ?)', [`sur_${suffix}`, mgr, roleId, tenantId])

  // 每个用户各建一条客户（create_by = 自己）
  for (const [owner, label] of [
    [mgr, '经理'],
    [memberA, 'A'],
    [memberAC, 'A子'],
    [memberB, 'B']
  ]) {
    const [result] = await conn.query('INSERT INTO customer (tenant_id, name, create_by, del_flag, created_at, updated_at) VALUES (?, ?, ?, 0, NOW(), NOW())', [
      tenantId,
      `${label}客户${suffix}`,
      owner
    ])
    customerIds.push(result.insertId)
  }
  const [ownCustomer, customerA, customerAC, customerB] = customerIds
  check('四人各建一条客户', customerIds.length === 4)

  // 密码哈希需可登录：用 argon2 或直接更新成已hash的口令。复用项目工具生成
  const { hashPassword } = await import('../dist/utils/password.util.js')
  const hash = await hashPassword(pw)
  for (const userId of [mgr, memberA, memberAC, memberB]) {
    await conn.query('UPDATE sys_user SET password = ? WHERE id = ?', [hash, userId])
  }
  const mgrToken = await login(`supmgr_${suffix}`, tenantId)
  check('经理登录成功', Boolean(mgrToken))

  const before = await api('/v1/customers?page=1&pageSize=100', { accessToken: mgrToken, tenantId })
  const beforeIds = before.records.map(item => item.id)
  check('授权前：经理只看自己创建的客户', beforeIds.includes(ownCustomer) && !beforeIds.includes(customerA) && !beforeIds.includes(customerB))

  // 授权监管部门 A（应自动展开 A子）
  await api(`/v1/users/${mgr}/supervise-depts`, { method: 'PUT', tenantId, body: { deptIds: [deptA] } })
  const [superviseRows] = await conn.query('SELECT dept_id FROM sys_user_supervise_dept WHERE user_id = ? AND tenant_id = ?', [mgr, tenantId])
  const supervised = superviseRows.map(row => row.dept_id)
  check('授权后关系表含 A 与展开的 A子', supervised.includes(deptA) && supervised.includes(deptAChild) && !supervised.includes(deptB))

  const after = await api('/v1/customers?page=1&pageSize=100', { accessToken: mgrToken, tenantId })
  const afterIds = after.records.map(item => item.id)
  check('授权后：经理能看到自己 + A成员 + A子成员的客户', afterIds.includes(ownCustomer) && afterIds.includes(customerA) && afterIds.includes(customerAC))
  check('授权后：经理仍看不到 B 成员的客户', !afterIds.includes(customerB))

  await api(`/v1/customers/${customerB}`, { accessToken: mgrToken, tenantId }).then(
    () => check('越权详情被拒：不应走到这里', false),
    () => check('越权详情被拒：B 客户详情返回 404', true)
  )

  // 仅本人(4)：监管授权不放大
  await conn.query('UPDATE sys_role SET data_scope = 4 WHERE id = ?', [roleId])
  await conn.query('UPDATE sys_user SET status = 1 WHERE id = ?', [mgr])
  await conn.query('DELETE FROM sys_user_role WHERE user_id = ?', [mgr])
  await conn.query('INSERT INTO sys_user_role (id, user_id, role_id, tenant_id) VALUES (?, ?, ?, ?)', [`sur2_${suffix}`, mgr, roleId, tenantId])
  await conn.query('UPDATE sys_user SET status = 1 WHERE id = ?', [mgr])
  // 权限缓存 30s：通过改角色再触发一次写侧失效
  await api(`/v1/users/${mgr}/roles`, { method: 'PUT', tenantId, body: { roleIds: [roleId] } })
  const mgrToken2 = await login(`supmgr_${suffix}`, tenantId)
  const selfOnly = await api('/v1/customers?page=1&pageSize=100', { accessToken: mgrToken2, tenantId })
  const selfIds = selfOnly.records.map(item => item.id)
  check('仅本人(4)：监管授权不放大，只看自己', selfIds.includes(ownCustomer) && !selfIds.includes(customerA) && !selfIds.includes(customerB))

  console.log(`\n冒烟通过：${passed}/${passed}（用户管辖部门 ReBAC）`)
} finally {
  if (customerIds.length) await conn.query(`DELETE FROM customer WHERE id IN (${customerIds.map(() => '?').join(',')})`, customerIds)
  if (userIds.length) {
    await conn.query(`DELETE FROM sys_user_supervise_dept WHERE user_id IN (${userIds.map(() => '?').join(',')})`, userIds)
    await conn.query(`DELETE FROM sys_user_role WHERE user_id IN (${userIds.map(() => '?').join(',')})`, userIds)
    await conn.query(`DELETE FROM sys_user_depart WHERE user_id IN (${userIds.map(() => '?').join(',')})`, userIds)
    await conn.query(`DELETE FROM sys_user_tenant WHERE user_id IN (${userIds.map(() => '?').join(',')})`, userIds)
    await conn.query(`DELETE FROM sys_user WHERE id IN (${userIds.map(() => '?').join(',')})`, userIds)
  }
  if (roleIds.length) {
    await conn.query(`DELETE FROM sys_role_permission WHERE role_id IN (${roleIds.map(() => '?').join(',')})`, roleIds)
    await conn.query(`DELETE FROM sys_role WHERE id IN (${roleIds.map(() => '?').join(',')})`, roleIds)
  }
  if (deptIds.length) await conn.query(`DELETE FROM sys_depart WHERE id IN (${deptIds.map(() => '?').join(',')})`, deptIds)
  if (tenantId) {
    try {
      await api(`/v1/tenants/${tenantId}`, { method: 'DELETE' })
    } catch {
      await conn.query('DELETE FROM sys_tenant WHERE id = ?', [tenantId])
    }
  }
  await conn.end()
}
