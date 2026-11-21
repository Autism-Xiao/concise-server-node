/**
 * 记住登录凭证（方案 C）冒烟：发凭证 → 免密续登 → 换设备拒绝并作废 → 登出吊销 → 不勾选不签发
 *
 * 前置：本地起服务（默认 3461 端口）+ Redis 启用 + 跑过 179502 迁移。
 * 运行：node scripts/smoke-remember.mjs
 * 可用 SMOKE_BASE / SMOKE_ADMIN_PASSWORD 覆盖默认值。
 */
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3461/api'
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'admin123'

const DEVICE_A = 'smoke-device-alpha'
const DEVICE_B = 'smoke-device-beta'

let passed = 0
function ok(cond, label) {
  if (!cond) throw new Error(`断言失败：${label}`)
  passed++
  console.log(`  ✓ ${label}`)
}

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

async function loginWithRemember(days) {
  const res = await api('/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: ADMIN_PASSWORD, rememberMe: true, rememberDays: days, deviceId: DEVICE_A }
  })
  if (res.json?.code !== 0) throw new Error(`登录失败：${res.json?.message}`)
  return res.json.result
}

try {
  console.log('\n[1] 登录签发凭证')
  const r1 = await loginWithRemember(7)
  ok(typeof r1.rememberToken === 'string' && r1.rememberToken.length > 20, '勾选 rememberMe 返回 rememberToken')
  ok(r1.rememberDays === 7, '后端回显收敛后的记住天数 = 7')
  ok(!!r1.accessToken && !!r1.refreshToken, '令牌对正常返回')

  console.log('\n[2] 凭证免密续登（同设备）')
  const r2 = await api('/auth/remember/exchange', { method: 'POST', body: { token: r1.rememberToken, deviceId: DEVICE_A } })
  ok(r2.json?.code === 0, `同设备换取成功（${r2.json?.code === 0 ? 'code 0' : `code ${r2.json?.code} ${r2.json?.message}`})`)
  ok(!!r2.json?.result?.accessToken, '换取返回新 accessToken')
  const profile = await api('/auth/profile', { token: r2.json.result.accessToken })
  ok(profile.json?.code === 0, '换来的 accessToken 可访问 /auth/profile')

  console.log('\n[3] 换设备续登被拒且原凭证作废（防拷贝重放）')
  const bad = await api('/auth/remember/exchange', { method: 'POST', body: { token: r1.rememberToken, deviceId: DEVICE_B } })
  ok(bad.json?.code !== 0, '设备不匹配换取被拒')
  const after = await api('/auth/remember/exchange', { method: 'POST', body: { token: r1.rememberToken, deviceId: DEVICE_A } })
  ok(after.json?.code !== 0, '设备不匹配后原凭证已作废')

  console.log('\n[4] 登出吊销')
  const r4 = await loginWithRemember(1)
  const rev = await api('/auth/remember/revoke', { method: 'POST', body: { token: r4.rememberToken } })
  ok(rev.json?.code === 0 && rev.json.result?.revoked === true, '吊销接口幂等返回 revoked:true')
  const ex = await api('/auth/remember/exchange', { method: 'POST', body: { token: r4.rememberToken, deviceId: DEVICE_A } })
  ok(ex.json?.code !== 0, '吊销后换取失败')

  console.log('\n[5] 不勾选不签发（存量登录行为不变）')
  const r5 = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: ADMIN_PASSWORD } })
  ok(r5.json?.code === 0, '普通登录成功')
  ok(!r5.json?.result?.rememberToken, '不勾选 rememberMe 不返回凭证')

  console.log(`\nsmoke-remember 通过：${passed} 项断言`)
} catch (err) {
  console.error('\nsmoke-remember 失败：', err.message)
  process.exit(1)
}
