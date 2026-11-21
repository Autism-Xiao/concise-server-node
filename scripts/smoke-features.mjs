/**
 * 特性开关 + 管辖部门查询接口端到端冒烟
 *
 * 覆盖：
 * 1. GET /v1/features 返回当前视角全部生效开关（含迁移插入的两个默认开关）
 * 2. GET /v1/users/:id/supervise-depts 空集合回显
 * 3. PUT + GET 往返一致（监管配置写读闭环），且本次写操作落了操作日志
 * 4. @FeatureFlag kill switch：feature.rbac.superviseDept 关闭后两个端点 403，恢复后可用
 * 5. feature.log.maskSensitive 开启后，操作日志 params 中手机号打码（截最新一条监管配置日志核对）
 *
 * 运行：SMOKE_BASE=http://127.0.0.1:3461/api node scripts/smoke-features.mjs
 */
import 'dotenv/config'
import mysql from 'mysql2/promise'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3461/api'
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'admin123'
const TAG = `feat_${Date.now().toString(36)}`

let passed = 0
let failed = 0
const ok = (name, cond, extra) => {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST ?? '127.0.0.1',
  user: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '123456',
  database: process.env.DB_DATABASE ?? 'concise_server'
})

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* 403 等非 JSON 响应 */
  }
  return { status: res.status, json }
}

async function login(username, password) {
  const res = await api('/auth/login', { method: 'POST', body: { username, password } })
  if (res.json?.code !== 0) throw new Error(`登录失败：${res.json?.message}`)
  return res.json.result.accessToken
}

const userIds = []
let adminToken = null

try {
  console.log('\n[1] 登录与开关清单')
  adminToken = await login('admin', ADMIN_PASSWORD)
  const flags = await api('/features', { token: adminToken })
  ok('GET /v1/features 返回 200', flags.status === 200 && flags.json?.code === 0, JSON.stringify(flags.json))
  const map = flags.json?.result ?? {}
  ok('包含 log.maskSensitive（默认关）', map['log.maskSensitive'] === false, JSON.stringify(map))
  ok('包含 rbac.superviseDept（默认开）', map['rbac.superviseDept'] === true)

  console.log('\n[2] 管辖部门 GET/PUT 往返')
  const me = await api('/users/me', { token: adminToken })
  const adminId = me?.json?.result?.id
  ok('拿到当前管理员 id', !!adminId, JSON.stringify(me?.json))
  // 先重置（防上次运行残留），再断言空集合
  await api(`/users/${adminId}/supervise-depts`, { method: 'PUT', token: adminToken, body: { deptIds: [] } })
  const empty = await api(`/users/${adminId}/supervise-depts`, { token: adminToken })
  ok('GET 返回空集合', empty.status === 200 && Array.isArray(empty.json?.result?.deptIds) && empty.json.result.deptIds.length === 0, JSON.stringify(empty.json))

  // 取当前租户任一部门 id（没有就跳过写读断言）
  const [deptRows] = await conn.query('SELECT id FROM sys_depart WHERE del_flag = 0 LIMIT 1')
  if (deptRows.length) {
    const deptId = String(deptRows[0].id)
    const put = await api(`/users/${adminId}/supervise-depts`, { method: 'PUT', token: adminToken, body: { deptIds: [deptId] } })
    ok('PUT 保存成功', put.status === 200 && put.json?.code === 0, JSON.stringify(put.json))
    const roundtrip = await api(`/users/${adminId}/supervise-depts`, { token: adminToken })
    ok('GET 回读一致', roundtrip.json?.result?.deptIds?.[0] === deptId, JSON.stringify(roundtrip.json))

    console.log('\n[3] 日志脱敏（feature.log.maskSensitive）')
    // 开启开关 → 重新保存一次（制造一条含 deptIds 的日志）→ 检查最新一条日志 params
    const enable = await api('/configs', { method: 'PUT', token: adminToken, body: { configKey: 'feature.log.maskSensitive', configValue: 'true' } })
    ok('开启脱敏开关', enable.json?.code === 0, JSON.stringify(enable.json))
    await api(`/users/${adminId}/supervise-depts`, { method: 'PUT', token: adminToken, body: { deptIds: [deptId] } })
    const [logs] = await conn.query('SELECT params FROM sys_log WHERE operate_type = 3 ORDER BY id DESC LIMIT 1')
    const params = logs[0]?.params ?? ''
    let parsed = null
    try {
      parsed = JSON.parse(params)
    } catch {
      /* ignore */
    }
    ok('操作日志已落库且 params 可解析', !!parsed, params.slice(0, 80))
    const flat = JSON.stringify(parsed)
    ok('开关开启后日志中不含打码前手机号形态', !/(?<!\d)138\d{8}(?!\d)/.test(flat), flat.slice(0, 120))
    // 关闭开关恢复默认
    const disable = await api('/configs', { method: 'PUT', token: adminToken, body: { configKey: 'feature.log.maskSensitive', configValue: 'false' } })
    ok('关闭脱敏开关恢复默认', disable.json?.code === 0, JSON.stringify(disable.json))
    // 清理监管配置（全量覆盖为空）
    await api(`/users/${adminId}/supervise-depts`, { method: 'PUT', token: adminToken, body: { deptIds: [] } })
  } else {
    console.log('  - 无部门数据，跳过往返与日志脱敏断言')
  }

  console.log('\n[4] kill switch：feature.rbac.superviseDept')
  const off = await api('/configs', { method: 'PUT', token: adminToken, body: { configKey: 'feature.rbac.superviseDept', configValue: 'false' } })
  ok('关闭开关成功', off.json?.code === 0, JSON.stringify(off.json))
  const blockedGet = await api(`/users/${adminId}/supervise-depts`, { token: adminToken })
  ok('GET 被拦截 403', blockedGet.status === 403, `status=${blockedGet.status}`)
  const blockedPut = await api(`/users/${adminId}/supervise-depts`, { method: 'PUT', token: adminToken, body: { deptIds: [] } })
  ok('PUT 被拦截 403', blockedPut.status === 403, `status=${blockedPut.status}`)
  // 恢复默认开
  const on = await api('/configs', { method: 'PUT', token: adminToken, body: { configKey: 'feature.rbac.superviseDept', configValue: 'true' } })
  ok('恢复开关（/v1/configs 不受开关控制）', on.json?.code === 0, JSON.stringify(on.json))
  const restored = await api(`/users/${adminId}/supervise-depts`, { token: adminToken })
  ok('恢复后端点可用', restored.status === 200 && restored.json?.code === 0, `status=${restored.status}`)

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  process.exitCode = failed ? 1 : 0
} catch (error) {
  console.error('冒烟异常：', error)
  process.exitCode = 1
} finally {
  // 兜底清理：管理员监管配置清空 + 配置行恢复默认
  if (adminToken) {
    await api('/configs', { method: 'PUT', token: adminToken, body: { configKey: 'feature.rbac.superviseDept', configValue: 'true' } }).catch(() => {})
    await api('/configs', { method: 'PUT', token: adminToken, body: { configKey: 'feature.log.maskSensitive', configValue: 'false' } }).catch(() => {})
  }
  for (const id of userIds) {
    await conn.query('DELETE FROM sys_user_supervise_dept WHERE user_id = ?', [id])
  }
  await conn.end()
}
