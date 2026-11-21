/**
 * 租户仪表盘 + API 配额冒烟
 *
 * 前置：本地实例（CAPTCHA_ENABLED=false），SMOKE_BASE 指向实例，MySQL 直连清理残留。
 * 覆盖：
 *  1. GET /v1/tenants/dashboard 结构与口径（概览五计数、套餐分布、注册趋势、API Top、配额水位）
 *  2. tenant.quota.apiCalls 月度配额：前 N 次放行、超限 429（平台行配置，X-Tenant-Id 以超管视角模拟租户）
 *  3. 白名单：/v1/metering、/v1/auth 在超限后仍可访问
 *  4. 恢复配置与清理残留
 */
import 'dotenv/config'
import mysql from 'mysql2/promise'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3459/api'
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? 'admin123'

const DB = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'concise_server'
}

let passed = 0
let failed = 0
function ok(cond, label) {
  if (cond) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.log(`  ✗ ${label}`)
  }
}

async function api(path, { method = 'GET', token, body, tenantId } = {}) {
  const res = await fetch(`${BASE}/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tenantId ? { 'X-Tenant-Id': String(tenantId) } : {})
    },
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

const QUOTA_CODE = 'smoke_quota_dash'
const conn = await mysql.createConnection(DB)

try {
  // 前置清理：上次失败残留（按唯一编码精确命中；配置值强制复位）
  await conn.query(`DELETE FROM sys_tenant WHERE code = ?`, [QUOTA_CODE])
  await conn.query(`UPDATE sys_config SET config_value = '0' WHERE config_key = 'tenant.quota.apiCalls' AND tenant_id = 0`)

  console.log('\n[1] 平台登录 + 仪表盘结构')
  const token = await login('admin', ADMIN_PASSWORD)
  const dash = await api('/tenants/dashboard', { token })
  ok(dash.json?.code === 0, `dashboard 接口 200：${dash.json?.code === 0 ? 'ok' : dash.json?.message}`)
  const d = dash.json?.result ?? {}
  ok(typeof d.overview?.total === 'number' && typeof d.overview?.active === 'number' && typeof d.overview?.expiringIn30 === 'number', '概览五计数齐全（total/active/disabled/expiredActive/expiringIn30）')
  ok(Array.isArray(d.planDistribution) && Array.isArray(d.registerTrend) && Array.isArray(d.apiCallsTop) && Array.isArray(d.quotaWater), '四个聚合数组均存在')
  const months = (d.registerTrend ?? []).map(r => r.month)
  ok(months.every((m, i) => i === 0 || m > months[i - 1]) && months.every(m => /^\d{4}-\d{2}$/.test(m)), `注册趋势按月升序：[${months.join(', ')}]`)

  console.log('\n[2] 造租户 + 验证注册趋势消费')
  const created = await api('/tenants', { method: 'POST', token, body: { name: '冒烟配额租户', code: QUOTA_CODE, plan: 'trial' } })
  ok(created.json?.code === 0, `创建冒烟租户：${created.json?.code === 0 ? QUOTA_CODE : created.json?.message}`)
  const tenantId = created.json?.result?.id
  ok(Number(tenantId) > 0, `拿到租户 id：${tenantId}`)

  const dash2 = await api('/tenants/dashboard', { token })
  const trendCount = (dash2.json?.result?.registerTrend ?? []).find(r => r.month === new Date().toISOString().slice(0, 7))?.count ?? 0
  ok(trendCount >= 1, '新开租户计入当月注册趋势')

  console.log('\n[3] API 调用量配额（月度 5 次上限）')
  const setLimit = await api('/configs', { method: 'PUT', token, body: { configKey: 'tenant.quota.apiCalls', configValue: '5' } })
  ok(setLimit.json?.code === 0, `配置平台行 tenant.quota.apiCalls=5：${setLimit.json?.code === 0 ? 'ok' : setLimit.json?.message}`)

  // 前 5 次放行（GET /features 计入 api.calls）
  let granted = 0
  let firstReject = null
  for (let i = 1; i <= 8; i++) {
    const r = await api('/features', { token, tenantId })
    if (r.json?.code === 0) granted++
    else if (!firstReject) firstReject = { i, status: r.status, message: r.json?.message }
  }
  ok(granted === 5, `前 5 次放行：实际 ${granted} 次`)
  ok(!!firstReject && firstReject.status === 429, `第 ${firstReject?.i ?? '?'} 次起 429：${firstReject?.message ?? '未触发'}`)

  console.log('\n[4] 白名单：超限后 metering/auth 仍可访问')
  const meter = await api('/metering/usage', { token, tenantId })
  ok(meter.json?.code === 0, `metering/usage 放行：${meter.json?.code === 0 ? 'ok' : meter.json?.message}`)
  const me = await api('/users/me', { token })
  ok(me.json?.code === 0, `无 X-Tenant-Id（平台视角）不受配额影响：${me.json?.code === 0 ? 'ok' : me.json?.message}`)

  console.log('\n[5] 恢复配置 + 清理')
  const reset = await api('/configs', { method: 'PUT', token, body: { configKey: 'tenant.quota.apiCalls', configValue: '0' } })
  ok(reset.json?.code === 0, `复位 tenant.quota.apiCalls=0：${reset.json?.code === 0 ? 'ok' : reset.json?.message}`)
  const after = await api('/features', { token, tenantId })
  ok(after.json?.code === 0, '复位后原租户请求恢复放行')

  await conn.query(`DELETE FROM sys_tenant WHERE code = ?`, [QUOTA_CODE])
  ok(true, '清理冒烟租户')
} catch (error) {
  failed++
  console.log(`  ✗ 异常中断：${error.message}`)
} finally {
  await conn.query(`UPDATE sys_config SET config_value = '0' WHERE config_key = 'tenant.quota.apiCalls' AND tenant_id = 0`).catch(() => {})
  await conn.query(`DELETE FROM sys_tenant WHERE code = ?`, [QUOTA_CODE]).catch(() => {})
  await conn.end()
}

console.log(`\n通过 ${passed}/${passed + failed}`)
process.exit(failed === 0 ? 0 : 1)
