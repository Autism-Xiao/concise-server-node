/**
 * 平台管理员授予/取消冒烟：权限点 scope=platform + 不能取消自己/最后一个 + 通用更新接口写不进去
 *
 * BASE_URL=http://127.0.0.1:3461 node scripts/smoke-platform-admin.mjs
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3461'
const API = `${BASE}/api/v1`
const ADMIN = { username: 'admin', password: 'admin123' }

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) {
    pass += 1
    console.log(`PASS  ${name}`)
  } else {
    fail += 1
    console.log(`FAIL  ${name} — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
  }
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  return { status: res.status, body: json, result: json?.result }
}

async function login(username, password) {
  const res = await api('/auth/login', { method: 'POST', body: { username, password } })
  if (!res.result?.accessToken) throw new Error(`登录失败 ${username}: ${res.status} ${JSON.stringify(res.body)}`)
  return res.result.accessToken
}

const stamp = Date.now().toString(36)
const username = `pf_${stamp}`
const password = 'Pf123456'

const adminToken = await login(ADMIN.username, ADMIN.password)
const created = await api('/users', {
  method: 'POST',
  token: adminToken,
  body: { username, realname: '平台管理员冒烟', password, status: 1 }
})
const userId = created.result?.id
if (!userId) throw new Error(`建用户失败: ${created.status} ${JSON.stringify(created.body)}`)

try {
  // 1. 列表带出 isPlatformAdmin 字段
  const list = await api('/users?page=1&pageSize=100', { token: adminToken })
  const row = (list.result?.records ?? []).find(item => item.id === userId)
  check('列表返回 isPlatformAdmin 字段', row !== undefined && row.isPlatformAdmin !== undefined, row)

  // 2. 普通更新接口改不动它（字段被 strip）
  await api(`/users/${userId}`, { method: 'PUT', token: adminToken, body: { realname: '平台管理员冒烟', isPlatformAdmin: 1 } })
  const afterUpdate = await api(`/users/${userId}`, { token: adminToken })
  check('通用更新接口无法写入 isPlatformAdmin', Number(afterUpdate.result?.isPlatformAdmin) === 0, afterUpdate.result?.isPlatformAdmin)

  // 3. 授予
  const grant = await api(`/users/${userId}/platform-admin`, { method: 'PUT', token: adminToken, body: { isPlatformAdmin: true } })
  check('授予平台管理员成功', grant.status < 400 && Number(grant.result?.isPlatformAdmin) === 1, grant.body)

  // 4. 被授予者现在能进平台视角
  const userToken = await login(username, password)
  const mine = await api('/tenants/mine', { token: userToken })
  check('被授予者 isSuper=true', mine.result?.isSuper === true, mine.result)

  // 5. 不能取消自己
  const selfRevoke = await api(`/users/${userId}/platform-admin`, { method: 'PUT', token: userToken, body: { isPlatformAdmin: false } })
  check('取消自己 → 400', selfRevoke.status === 400, `${selfRevoke.status} ${JSON.stringify(selfRevoke.body)}`)

  // 6. 取消（由 admin 操作）
  const revoke = await api(`/users/${userId}/platform-admin`, { method: 'PUT', token: adminToken, body: { isPlatformAdmin: false } })
  check('由其他平台管理员取消成功', revoke.status < 400 && Number(revoke.result?.isPlatformAdmin) === 0, revoke.body)

  // 7. 非平台管理员调用 → 403（被取消后重新登录拿新 token 才准）
  const plainToken = await login(username, password)
  const forbidden = await api(`/users/${userId}/platform-admin`, { method: 'PUT', token: plainToken, body: { isPlatformAdmin: true } })
  check('非平台管理员调用 → 403', forbidden.status === 403, `${forbidden.status} ${JSON.stringify(forbidden.body)}`)

  // 8. 幂等：重复授予同值不报错
  const idempotent = await api(`/users/${userId}/platform-admin`, { method: 'PUT', token: adminToken, body: { isPlatformAdmin: false } })
  check('重复取消幂等', idempotent.status < 400, idempotent.status)
} finally {
  await api(`/users/${userId}`, { method: 'DELETE', token: adminToken })
  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`)
  if (fail > 0) process.exitCode = 1
}
