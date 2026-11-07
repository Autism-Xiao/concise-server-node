/**
 * 登录锁定 + 水印权限收紧冒烟
 *
 * 覆盖：
 * 1. 密码错误提示剩余次数（1~4 次），第 5 次锁定 1 天（429 + ACCOUNT_LOCKED），锁定期内正确密码也拒绝
 * 2. 管理员解锁（DELETE /users/:id/lock）后恢复正常登录
 * 3. 锁屏 verify-password 与登录共用失败计数，且未锁定用 400（不能用 401，前端会踢登录态）
 * 4. 水印开关只归超管：普通用户 resolve.editable=false、PUT /users/me/watermark 403；
 *    管理员按用户强制开启后该用户 enabled=true 且仍不可改
 *
 * 前置：PORT=3461 CAPTCHA_ENABLED=false node dist/main.js
 * 运行：node scripts/smoke-auth-lock-watermark.mjs（临时用户自动软删）
 */

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3461/api/v1'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin123'
const USERNAME = `smoke_lock_${Date.now().toString(36)}`
const PASSWORD = 'Smoke@123456'

let pass = 0
let fail = 0
const check = (label, ok, extra = '') => {
  if (ok) {
    pass++
    console.log(`PASS  ${label}`)
  } else {
    fail++
    console.log(`FAIL  ${label}${extra ? ` — ${extra}` : ''}`)
  }
}

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, body: json, data: json?.result ?? json?.data ?? json }
}

async function login(username, password) {
  return api('/auth/login', { method: 'POST', body: { username, password } })
}

let tempUserId = null
try {
  const adminLogin = await login('admin', ADMIN_PASSWORD)
  const adminToken = adminLogin.data?.accessToken
  check('admin 登录（种子账号密码正确）', adminLogin.status === 200 && !!adminToken, JSON.stringify(adminLogin.body).slice(0, 160))
  if (!adminToken) throw new Error('admin 登录失败，终止冒烟')

  // ---------- 1. 临时用户 + 首次登录 ----------
  const created = await api('/users', {
    method: 'POST',
    token: adminToken,
    body: { username: USERNAME, realname: '冒烟锁定', password: PASSWORD, status: 1 }
  })
  tempUserId = created.data?.id ?? null
  check('创建临时用户', created.status === 201 && !!tempUserId, JSON.stringify(created.body).slice(0, 160))
  if (!tempUserId) throw new Error('临时用户创建失败，终止冒烟')

  const firstLogin = await login(USERNAME, PASSWORD)
  check('临时用户首次登录成功', firstLogin.status === 200 && !!firstLogin.data?.accessToken, JSON.stringify(firstLogin.body).slice(0, 160))

  // ---------- 2. 连续错误 4 次：提示剩余次数，仍是 401 ----------
  for (let i = 1; i <= 4; i++) {
    const res = await login(USERNAME, 'wrong-password')
    const message = String(res.body?.message ?? '')
    const expected = `还可尝试 ${5 - i} 次`
    check(`第 ${i} 次密码错误 → 401 + 「${expected}」`, res.status === 401 && message.includes(expected), `${res.status} ${message.slice(0, 120)}`)
  }

  // ---------- 3. 第 5 次触发锁定：429 + ACCOUNT_LOCKED ----------
  const fifth = await login(USERNAME, 'wrong-password')
  const fifthMsg = String(fifth.body?.message ?? '')
  check(
    '第 5 次密码错误 → 429 + 已锁定文案',
    fifth.status === 429 && fifthMsg.includes('已锁定') && fifth.body?.code === 1009,
    `${fifth.status} code=${fifth.body?.code} ${fifthMsg.slice(0, 120)}`
  )
  check('锁定文案含时长（1 天/24 小时）', /1 天|24 小时/.test(fifthMsg), fifthMsg.slice(0, 120))

  // ---------- 4. 锁定期内即使密码正确也拒绝 ----------
  const duringLock = await login(USERNAME, PASSWORD)
  check('锁定期内正确密码登录 → 429', duringLock.status === 429, `${duringLock.status} ${String(duringLock.body?.message ?? '').slice(0, 120)}`)

  // ---------- 5. 管理员解锁 → 恢复正常 ----------
  const unlocked = await api(`/users/${tempUserId}/lock`, { method: 'DELETE', token: adminToken })
  check('管理员解锁 → 200', unlocked.status === 200, `${unlocked.status} ${JSON.stringify(unlocked.body).slice(0, 120)}`)
  const afterUnlock = await login(USERNAME, PASSWORD)
  const userToken = afterUnlock.data?.accessToken
  check('解锁后正常登录', afterUnlock.status === 200 && !!userToken, `${afterUnlock.status} ${JSON.stringify(afterUnlock.body).slice(0, 160)}`)

  // ---------- 6. 锁屏 verify-password：共用计数、未锁定用 400 ----------
  const wrongVerify = await api('/auth/verify-password', { method: 'POST', token: userToken, body: { password: 'wrong-password' } })
  const verifyMsg = String(wrongVerify.body?.message ?? '')
  check(
    '锁屏密码错误 → 400 + 「还可尝试 4 次」',
    wrongVerify.status === 400 && verifyMsg.includes('还可尝试 4 次'),
    `${wrongVerify.status} ${verifyMsg.slice(0, 120)}`
  )
  const okVerify = await api('/auth/verify-password', { method: 'POST', token: userToken, body: { password: PASSWORD } })
  check('锁屏正确密码 → verified', okVerify.status === 200 && okVerify.data?.verified === true, `${okVerify.status} ${JSON.stringify(okVerify.body).slice(0, 120)}`)

  // ---------- 7. 水印：普通用户只读 ----------
  const userWm = await api('/users/me/watermark', { token: userToken })
  check('普通用户 resolve.editable=false', userWm.status === 200 && userWm.data?.editable === false, JSON.stringify(userWm.data).slice(0, 200))
  check('普通用户 resolve.reason 有说明', typeof userWm.data?.reason === 'string' && userWm.data.reason.length > 0, String(userWm.data?.reason))
  const userPut = await api('/users/me/watermark', { method: 'PUT', token: userToken, body: { enabled: false } })
  check('普通用户改自己水印 → 403', userPut.status === 403, `${userPut.status} ${String(userPut.body?.message ?? '').slice(0, 120)}`)

  // ---------- 8. 水印：管理员可改自己 + 可强制某用户 ----------
  const adminWmBefore = await api('/users/me/watermark', { token: adminToken })
  check('超管 resolve.editable=true（可选模式下可自管）', adminWmBefore.data?.editable === true, JSON.stringify(adminWmBefore.data).slice(0, 200))
  const adminPut = await api('/users/me/watermark', { method: 'PUT', token: adminToken, body: { enabled: true } })
  check('超管改自己水印 → 200', adminPut.status === 200 && adminPut.data?.enabled === true, `${adminPut.status} ${JSON.stringify(adminPut.body).slice(0, 160)}`)

  const enforce = await api(`/users/${tempUserId}/watermark`, { method: 'PUT', token: adminToken, body: { enforced: 1 } })
  check('管理员给用户 enforced=1', enforce.status === 200 && enforce.data?.enforced === 1, `${enforce.status} ${JSON.stringify(enforce.body).slice(0, 160)}`)
  const afterEnforce = await api('/users/me/watermark', { token: userToken })
  check(
    '被强制开启后该用户 enabled=true 且仍不可改',
    afterEnforce.data?.enabled === true && afterEnforce.data?.editable === false && String(afterEnforce.data?.reason ?? '').includes('强制开启'),
    JSON.stringify(afterEnforce.data).slice(0, 200)
  )

  // 恢复：解除强制（不动全局策略）
  await api(`/users/${tempUserId}/watermark`, { method: 'PUT', token: adminToken, body: { enforced: 0 } })
  const backToGlobal = await api('/users/me/watermark', { token: userToken })
  check('解除 enforced 后回到全局策略', backToGlobal.data?.enforced === 0 && backToGlobal.data?.editable === false, JSON.stringify(backToGlobal.data).slice(0, 200))

  // 还原超管自己的开关，避免影响真实环境
  await api('/users/me/watermark', {
    method: 'PUT',
    token: adminToken,
    body: { enabled: adminWmBefore.data?.custom?.enabled === null ? null : adminWmBefore.data?.custom?.enabled === 1 }
  })
} catch (error) {
  fail++
  console.log(`FAIL  冒烟异常：${error instanceof Error ? error.message : String(error)}`)
} finally {
  if (tempUserId) {
    const adminRelogin = await login('admin', ADMIN_PASSWORD)
    const token = adminRelogin.data?.accessToken
    await api(`/users/${tempUserId}`, { method: 'DELETE', token })
    console.log(`清理：临时用户 ${USERNAME} 已软删`)
  }
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail === 0 ? 0 : 1)
}
