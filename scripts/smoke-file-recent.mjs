#!/usr/bin/env node
/**
 * 冒烟：最近文件（/v1/files/recent）的租户隔离
 *
 * 守的是 file.service.recent 曾经只按 owner_id 查、不带租户条件的漏网：
 * 同一账号在 A、B 两个租户下，"最近文件"会把另一个租户的文件混进来。
 *
 * 数据准备走 API + 直连库（只插入两条无物理文件的 sys_file 元数据行）：
 * 1. 平台超管用 X-Tenant-Id 分别切到两个临时租户；
 * 2. 两行 owner_id 都是 admin，tenant_id 各是一个租户；
 * 3. recent 在 A 租户只能看到 A 的文件，在 B 租户只能看到 B 的文件。
 *
 * 运行：node scripts/smoke-file-recent.mjs
 * 环境变量：SMOKE_BASE（默认 http://127.0.0.1:3461/api）、DB_* 同 .env
 */
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import 'dotenv/config'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3461/api'
let token = ''

async function api(path, { method = 'GET', body, tenantId } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
const tenantIds = []
const fileIds = []
let passed = 0

function check(label, condition) {
  assert.ok(condition, label)
  passed++
  console.log(`  ✓ ${label}`)
}

try {
  const login = await api('/v1/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })
  token = login.accessToken ?? login.access_token ?? login.token
  check('管理员登录拿到令牌', Boolean(token))

  const [[admin]] = await conn.query("SELECT id FROM sys_user WHERE username = 'admin' AND del_flag = 0")
  check('查到 admin 账号', Boolean(admin?.id))

  for (const side of ['a', 'b']) {
    const tenant = await api('/v1/tenants', {
      method: 'POST',
      body: { name: `冒烟最近文件${side.toUpperCase()}${suffix}`, code: `smk_recent_${side}_${suffix}`, plan: 'standard' }
    })
    tenantIds.push(tenant.id)
  }
  const [tenantA, tenantB] = tenantIds
  check('创建两个临时租户', tenantA > 0 && tenantB > 0 && tenantA !== tenantB)

  for (const tenantId of tenantIds) {
    const [result] = await conn.query(
      `INSERT INTO sys_file
        (tenant_id, parent_id, name, is_folder, ext, mime, size, storage_key, hash, owner_id, dept_id, is_starred, is_deleted, sort_order, create_time, update_time)
       VALUES (?, 0, ?, 0, 'txt', 'text/plain', 4, '', '', ?, 0, 0, 0, 0, NOW(), NOW())`,
      [tenantId, `recent-smoke-${suffix}-${tenantId}.txt`, admin.id]
    )
    fileIds.push(result.insertId)
  }
  const [fileA, fileB] = fileIds

  const recentA = await api('/v1/files/recent?limit=50', { tenantId: tenantA })
  check(
    'A 租户能看到本租户的最近文件',
    recentA.some(item => item.id === fileA)
  )
  check('A 租户看不到 B 租户的最近文件', !recentA.some(item => item.id === fileB))

  const recentB = await api('/v1/files/recent?limit=50', { tenantId: tenantB })
  check(
    'B 租户能看到本租户的最近文件',
    recentB.some(item => item.id === fileB)
  )
  check('B 租户看不到 A 租户的最近文件', !recentB.some(item => item.id === fileA))

  console.log(`\n冒烟通过：${passed}/${passed}（最近文件租户隔离）`)
} finally {
  if (fileIds.length) {
    await conn.query(`DELETE FROM sys_file WHERE id IN (${fileIds.map(() => '?').join(',')})`, fileIds)
  }
  for (const id of tenantIds) {
    try {
      await api(`/v1/tenants/${id}`, { method: 'DELETE' })
    } catch {
      // 清理失败不掩盖断言结果；软删残留由 cleanup-smoke-data.mjs 兜底
      console.warn(`清理租户 ${id} 失败（不影响本次断言）`)
    }
  }
  await conn.end()
}
