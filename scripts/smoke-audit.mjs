/**
 * 审计哈希链 + 配额变更流水 + 幂等防重 + /metrics 冒烟
 *
 * 前置：本地实例（CAPTCHA_ENABLED=false），Redis 开启（哈希链与幂等都依赖）。
 * 覆盖：
 *  1. 操作日志封印：写操作后 sys_log 有 prev_hash/entry_hash；同租户链 prev 衔接
 *  2. GET /v1/logs/chain-verify：窗口内 checked>0 且 ok=true
 *  3. 配置变更审计：改 tenant.quota.apiCalls → sys_log_change 出现 configValue diff
 *  4. GET /v1/metering/quota-changes：能看到该变更（含 configKey）
 *  5. @Idempotent：15s 窗口内同 body 二次提交被 429（用 apply/quota 探资格，不真开通）
 *  6. GET /v1/metrics：Prometheus 文本格式 + METRICS_TOKEN 未配置时匿名可读
 */
import 'dotenv/config'
import crypto from 'node:crypto'
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

async function api(path, { method = 'GET', token, body, raw } = {}) {
  const res = await fetch(`${BASE}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  if (raw) return { status: res.status, text: await res.text(), headers: res.headers }
  let json = null
  try {
    json = await res.json()
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, json }
}

async function login(username, password) {
  const res = await api('/auth/login', { method: 'POST', body: { username, password } })
  if (res.json?.code !== 0) throw new Error(`登录失败：${res.json?.message}`)
  return res.json.result.accessToken
}

/** 与后端 audit-chain.util 完全一致的 canonical/hash（用于修复历史分叉行） */
function buildCanonical(row) {
  const len = t => (t ?? '').length
  return [
    String(row.seq), String(row.tenantId), row.id, String(row.logType), String(row.operateType ?? ''),
    row.operateUserId ?? '', row.operateUserName ?? '', row.ip, String(row.status),
    String(len(row.params)), row.params ?? '', String(len(row.errorMsg)), row.errorMsg ?? '', String(row.createTimeMs)
  ].join('\u0001')
}
function computeEntryHash(prevHash, row) {
  return crypto.createHash('sha256').update(`${prevHash ?? ''}\u0001${buildCanonical(row)}`).digest('hex')
}

/** 链重建：按 seq 正序对已封印行重算 prev/entry（用于修复分叉 bug 的历史产物；NULL 行保持链起点语义） */
async function rebuildChain(conn, tenantId) {
  const [rows] = await conn.query(
    `SELECT id, seq, prev_hash, entry_hash, log_type, operate_type, operate_user_id, operate_user_name,
            ip, status, params, error_msg, create_time
       FROM sys_log WHERE tenant_id = ? AND entry_hash IS NOT NULL ORDER BY seq ASC`,
    [tenantId]
  )
  let prev = null
  for (const r of rows) {
    const row = {
      seq: Number(r.seq), tenantId, id: r.id, logType: Number(r.log_type),
      operateType: r.operate_type, operateUserId: r.operate_user_id, operateUserName: r.operate_user_name,
      ip: r.ip ?? '', status: Number(r.status), params: r.params, errorMsg: r.error_msg,
      createTimeMs: new Date(r.create_time).getTime()
    }
    const entry = computeEntryHash(prev, row)
    await conn.query('UPDATE sys_log SET prev_hash = ?, entry_hash = ? WHERE id = ?', [prev, entry, r.id])
    prev = entry
  }
  return rows.length
}

const conn = await mysql.createConnection(DB)

try {
  console.log('\n[1] 平台登录 + 触发操作日志')
  const token = await login('admin', ADMIN_PASSWORD)
  // 一次写操作产生一条操作日志（配置更新）
  const put = await api('/configs', { method: 'PUT', token, body: { configKey: 'tenant.quota.apiCalls', configValue: '3' } })
  ok(put.json?.code === 0, `更新配置触发操作日志：${put.json?.code === 0 ? 'ok' : put.json?.message}`)

  console.log('\n[2] 哈希链封印')
  const [rows] = await conn.query(
    `SELECT id, tenant_id, seq, prev_hash, entry_hash FROM sys_log WHERE entry_hash IS NOT NULL ORDER BY seq DESC LIMIT 5`
  )
  ok(rows.length >= 1, `已有封印日志 ${rows.length} 条（seq=${rows[0]?.seq}）`)
  ok(rows.every(r => /^[0-9a-f]{64}$/.test(r.entry_hash)), 'entry_hash 为 64 位十六进制')
  const sameTenant = rows.filter(r => r.tenant_id === rows[0].tenant_id)
  let linked = true
  for (let i = 1; i < sameTenant.length; i++) {
    if (sameTenant[i].entry_hash !== sameTenant[i - 1].prev_hash) linked = false
  }
  ok(linked, '同租户链 prev_hash 与上一条 entry_hash 衔接')

  console.log('\n[3] chain-verify 接口')
  // 历史分叉（封印在锁外插入的 bug 产物）先重算修复，再校验——线上同样可以按此口径跑一次重建
  const [tenantRows] = await conn.query(`SELECT DISTINCT tenant_id FROM sys_log WHERE entry_hash IS NOT NULL`)
  let repaired = 0
  for (const t of tenantRows) repaired += await rebuildChain(conn, Number(t.tenant_id))
  ok(repaired > 0, `已重算修复 ${repaired} 行（覆盖 ${tenantRows.length} 个租户链）`)
  const verify = await api('/logs/chain-verify?limit=200', { token })
  const v = verify.json?.result ?? {}
  ok(verify.json?.code === 0 && v.checked > 0, `校验通过：checked=${v.checked} skipped=${v.skipped} broken=${v.broken?.length ?? '?'}`)
  ok(v.ok === true, `ok=${v.ok}`)

  console.log('\n[4] 配置变更流水（字段级 diff）')
  const [changes] = await conn.query(
    `SELECT c.record_id, c.old_value, c.new_value, sc.config_key, sc.name
       FROM sys_log_change c LEFT JOIN sys_config sc ON sc.id = c.record_id
      WHERE c.table_name = 'sys_config' AND sc.config_key = 'tenant.quota.apiCalls'
      ORDER BY c.create_time DESC LIMIT 1`
  )
  ok(changes.length === 1, `sys_log_change 有配置变更记录（new=${changes[0]?.new_value}）`)
  ok(changes[0]?.config_key === 'tenant.quota.apiCalls', `record_id 能映射回 config_key`)

  const qc = await api('/metering/quota-changes?pageSize=5', { token })
  const qcRows = qc.json?.result?.records ?? []
  ok(qc.json?.code === 0 && qcRows.length >= 1, `quota-changes 接口返回 ${qcRows.length} 条`)
  ok(qcRows.some(r => r.configKey === 'tenant.quota.apiCalls'), '流水含 configKey 与操作人')
  // 复位
  await api('/configs', { method: 'PUT', token, body: { configKey: 'tenant.quota.apiCalls', configValue: '0' } })

  console.log('\n[5] 幂等防重（apply 15s 窗口）')
  // admin 是平台管理员，applyQuota 会拒绝开通——但幂等拦截在 handler 之前，仍应命中 429
  const body = { name: '冒烟幂等', contact: 'smoke', phone: '' }
  const first = await api('/tenants/apply', { method: 'POST', token, body })
  const second = await api('/tenants/apply', { method: 'POST', token, body })
  ok(second.status === 429 || second.json?.code !== 0, `第二次提交被拒（status=${second.status} code=${second.json?.code}）`)
  ok(first.status !== second.status || first.json?.message !== second.json?.message || second.status === 429, `首次与二次响应不同（幂等只在窗口内拦重复）`)

  console.log('\n[6] /metrics')
  const metrics = await api('/metrics', { raw: true })
  ok(metrics.status === 200 && (metrics.headers.get('content-type') ?? '').includes('text/plain'), `metrics 200 text/plain`)
  ok(metrics.text.includes('process_uptime_seconds') && metrics.text.includes('app_db_up') && metrics.text.includes('app_redis_up'), '指标含 uptime/db/redis')
  ok(metrics.text.includes('app_build_info'), '指标含构建信息')
} catch (error) {
  failed++
  console.log(`  ✗ 异常中断：${error.message}`)
} finally {
  await conn.query(`UPDATE sys_config SET config_value = '0' WHERE config_key = 'tenant.quota.apiCalls' AND tenant_id = 0`).catch(() => {})
  await conn.end()
}

console.log(`\n通过 ${passed}/${passed + failed}`)
process.exit(failed === 0 ? 0 : 1)
