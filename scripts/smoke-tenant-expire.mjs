/**
 * 租户到期生命周期冒烟：expiring 列表 + tenantExpireJob 提醒与去重 + 到期拦截语义
 *
 * 前置：本地起服务（CAPTCHA_ENABLED=false 才能让脚本登录）+ MySQL。
 * 运行：node scripts/smoke-tenant-expire.mjs
 * 可用 SMOKE_BASE / SMOKE_ADMIN_PASSWORD / DB_* 覆盖默认值。
 * 清理：脚本结束时删掉冒烟租户/任务/提醒消息（幂等残留可用 scripts/cleanup-smoke-data.mjs 兜底）。
 */
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3459/api'
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'admin123'

const mysql = await import('mysql2/promise')

const DB = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '123456',
  database: process.env.DB_DATABASE ?? 'concise_server'
}

const T_A = { name: '冒烟到期租户A', code: 'smoke_exp_a' }
const T_B = { name: '冒烟到期租户B', code: 'smoke_exp_b' }
const JOB_ID = 'smoke_exp_job_1'

let passed = 0
function ok(cond, label) {
  if (!cond) throw new Error(`断言失败：${label}`)
  passed++
  console.log(`  ✓ ${label}`)
}

function dateKey(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: res.status, json }
}

async function login(username, password) {
  const res = await api('/auth/login', { method: 'POST', body: { username, password } })
  if (res.json?.code !== 0) throw new Error(`登录失败：${res.json?.message}`)
  return res.json.result.accessToken
}

const conn = await mysql.createConnection(DB)

try {
  // 前置清理：上次失败残留（按固定 id / 标题 + 当天精确命中）
  await conn.query(`DELETE FROM sys_quartz_job WHERE id = ?`, [JOB_ID])
  for (const t of [T_A, T_B]) {
    const [rows] = await conn.query(`SELECT id FROM sys_tenant WHERE code = ?`, [t.code])
    for (const row of rows) await conn.query(`DELETE FROM sys_tenant WHERE id = ?`, [row.id])
  }

  console.log('\n[1] 平台登录 + 造临期/已到期租户')
  const token = await login('admin', ADMIN_PASSWORD)
  const plus2 = dateKey(2)
  const minus1 = dateKey(-1)
  const r1 = await api('/tenants', { method: 'POST', token, body: { name: T_A.name, code: T_A.code, plan: 'trial', expireAt: plus2 } })
  ok(r1.json?.code === 0, `创建临期租户（+2 天）成功：${r1.json?.code === 0 ? T_A.code : r1.json?.message}`)
  const r2 = await api('/tenants', { method: 'POST', token, body: { name: T_B.name, code: T_B.code, plan: 'trial', expireAt: minus1 } })
  ok(r2.json?.code === 0, `创建已到期租户（-1 天）成功：${r2.json?.code === 0 ? T_B.code : r2.json?.message}`)

  // 给租户 A 设 owner（到期提醒的接收人）：自助开通才有 owner，管理端创建没有，这里用 SQL 补
  const [adminRows] = await conn.query(`SELECT id FROM sys_user WHERE username = 'admin' AND del_flag = 0 LIMIT 1`)
  const adminUserId = adminRows[0].id
  await conn.query(`UPDATE sys_tenant SET owner_user_id = ? WHERE code = ?`, [adminUserId, T_A.code])

  console.log('\n[2] 即将到期列表')
  const r3 = await api('/tenants/expiring?days=30', { token })
  ok(r3.json?.code === 0, 'expiring 接口返回成功')
  const items = r3.json?.result ?? []
  const a = items.find(item => item.code === T_A.code)
  const b = items.find(item => item.code === T_B.code)
  ok(!!a, '临期租户 A 出现在列表')
  ok(a?.daysLeft === 2 && a?.expired === false, `A 剩余 2 天（实际 ${a?.daysLeft}）`)
  ok(!!b, '已到期租户 B 出现在列表')
  ok(b?.daysLeft === -1 && b?.expired === true, `B 已过期 1 天（实际 ${b?.daysLeft}）`)
  const sorted = items.filter(item => [T_A.code, T_B.code].includes(item.code))
  ok(sorted.length === 2 && sorted[0].code === T_B.code, '按到期日升序（已到期在前）')
  ok(a?.ownerName === 'admin', '带出开通人用户名')
  ok(Number(a?.userCount) === 0, '带出用户数')

  console.log('\n[3] tenantExpireJob 手动执行 → 站内信提醒')
  await conn.query(
    `INSERT INTO sys_quartz_job (id, job_class_name, cron_expression, parameter, description, tenant_id, status, del_flag, create_time)
     VALUES (?, 'tenantExpireJob', '0 0 9 * * ?', '7', '冒烟：租户到期提醒', 0, -1, 0, NOW())
     ON DUPLICATE KEY UPDATE del_flag = 0`,
    [JOB_ID]
  )
  const run1 = await api(`/jobs/${JOB_ID}/run`, { method: 'PUT', token })
  ok(run1.json?.code === 0, `任务执行成功：${run1.json?.result?.result ?? run1.json?.message ?? ''}`)
  const [msg1] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM sys_message m JOIN sys_message_user mu ON mu.message_id = m.id
      WHERE m.title = '租户到期提醒' AND mu.user_id = ? AND m.created_at >= CURDATE()`,
    [adminUserId]
  )
  ok(Number(msg1[0].cnt) >= 1, '开通人收到「租户到期提醒」站内信')
  const [summary1] = await conn.query(`SELECT COUNT(*) AS cnt FROM sys_message WHERE title = '租户已到期汇总' AND created_at >= CURDATE()`)
  ok(Number(summary1[0].cnt) >= 1, '平台管理员收到「租户已到期汇总」')

  console.log('\n[4] 重复执行去重（同日不重复轰炸）')
  await api(`/jobs/${JOB_ID}/run`, { method: 'PUT', token })
  const [msg2] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM sys_message m JOIN sys_message_user mu ON mu.message_id = m.id
      WHERE m.title = '租户到期提醒' AND mu.user_id = ? AND m.created_at >= CURDATE()`,
    [adminUserId]
  )
  ok(Number(msg2[0].cnt) === 1, '重复执行不产生第二条提醒（当天去重）')

  console.log('\n[5] 到期拦截语义（读取时判定）')
  // 已到期租户 B：平台管理员带 X-Tenant-Id 切进去会被 assertTenantUsable 拒绝
  const [bRows] = await conn.query(`SELECT id FROM sys_tenant WHERE code = ?`, [T_B.code])
  const bId = bRows[0].id
  const res = await fetch(`${BASE}/v1/tenants/${bId}/menus`, { headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': String(bId) } })
  const swJson = await res.json().catch(() => null)
  // 超管带 X-Tenant-Id 指向已到期租户：resolveTenant 的 assertTenantUsable 会直接 403
  ok(swJson?.code !== 0, '已到期租户作为请求上下文被 403 拦截')

  console.log(`\nsmoke-tenant-expire 通过：${passed} 项断言`)
} catch (err) {
  console.error('\nsmoke-tenant-expire 失败：', err.message)
  process.exitCode = 1
} finally {
  // 清理：冒烟租户 / 任务 / 提醒消息（按编码与固定 id 精确命中）
  for (const code of [T_A.code, T_B.code]) {
    await conn.query(`DELETE FROM sys_tenant WHERE code = ?`, [code])
  }
  await conn.query(`DELETE FROM sys_quartz_job WHERE id = ?`, [JOB_ID])
  await conn.query(
    `DELETE mu FROM sys_message_user mu JOIN sys_message m ON m.id = mu.message_id
      WHERE m.title IN ('租户到期提醒','租户已到期汇总') AND m.created_at >= CURDATE()`
  )
  await conn.query(`DELETE FROM sys_message WHERE title IN ('租户到期提醒','租户已到期汇总') AND created_at >= CURDATE()`)
  await conn.end()
}
