#!/usr/bin/env node
/**
 * 多租户隔离冒烟（P0/P1 改造后的回归）
 *
 * 覆盖：
 *  1. 平台管理员判定 = sys_user.is_platform_admin（不再看 role_code）
 *  2. 非平台管理员：不能切到不属于自己的租户、不能调平台级接口（@Perms scope=platform）
 *  3. 用户列表 / 选人 / 详情按 sys_user_tenant 收窄：租户下只看到本租户成员
 *  4. 审计日志按 tenant_id 隔离：租户审计员看不到别的租户的登录/操作明细
 *  5. 首页概览的裸 SQL 按租户聚合（角色数、公告、我的待办/存储）
 *  6. 水印策略按租户存：改租户 A 不影响平台默认与租户 B
 *
 * 用法（需要一个 CAPTCHA_ENABLED=false 的测试实例）：
 *   PORT=3461 CAPTCHA_ENABLED=false node dist/main.js
 *   BASE_URL=http://127.0.0.1:3461 node scripts/smoke-tenant-isolation.mjs
 *
 * 脚本自建自清：临时租户 + 临时用户，结束时删除。
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3461'
const ADMIN = { username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASS || 'admin123' }
const STAMP = Date.now().toString(36)

let pass = 0
const failures = []

function check(name, ok, detail) {
  if (ok) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    failures.push(name)
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
  }
}

async function api(path, { method = 'GET', token, tenant, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (tenant !== undefined && tenant !== null) headers['X-Tenant-Id'] = String(tenant)
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  let json
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { status: res.status, body: json, result: json?.result }
}

async function login(username, password) {
  const res = await api('/auth/login', { method: 'POST', body: { username, password } })
  if (res.status !== 200 || !res.result?.accessToken) {
    throw new Error(`登录失败 ${username}: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return res.result.accessToken
}

async function main() {
  console.log(`\n== 多租户隔离冒烟 @ ${BASE} ==\n`)

  const adminToken = await login(ADMIN.username, ADMIN.password)

  /* ---------- 1. 平台管理员判定 ---------- */
  const profile = await api('/auth/profile', { token: adminToken })
  check('admin 的 isPlatformAdmin = 1', Number(profile.result?.isPlatformAdmin) === 1, profile.result?.isPlatformAdmin)

  const adminMine = await api('/tenants/mine', { token: adminToken })
  check('admin 可作为平台视角（isSuper=true）', adminMine.result?.isSuper === true, adminMine.result?.isSuper)
  const adminCurrent = adminMine.result?.current
  check('admin 未指定租户时 current 为 null（平台视角）', adminCurrent === null, adminCurrent)

  /* ---------- 准备：临时租户 + 临时用户 ---------- */
  const tenantRes = await api('/tenants', { method: 'POST', token: adminToken, body: { name: `隔离测试租户${STAMP}`, code: `iso${STAMP}` } })
  const tenantId = tenantRes.result?.id
  if (!tenantId) throw new Error(`建租户失败: ${tenantRes.status} ${JSON.stringify(tenantRes.body)}`)

  // 第二个租户只用来验证「切到不属于自己的租户」：临时账号不会加入它
  const otherRes = await api('/tenants', { method: 'POST', token: adminToken, body: { name: `隔离测试租户B${STAMP}`, code: `isob${STAMP}` } })
  const otherTenantId = otherRes.result?.id

  const username = `iso_${STAMP}`
  const userRes = await api('/users', { method: 'POST', token: adminToken, body: { username, realname: '隔离测试账号', password: 'iso123456', status: 1 } })
  const userId = userRes.result?.id
  if (!userId) throw new Error(`建用户失败: ${userRes.status} ${JSON.stringify(userRes.body)}`)

  try {
    await api(`/tenants/${tenantId}/users`, { method: 'PUT', token: adminToken, body: { userIds: [userId] } })
    const userToken = await login(username, 'iso123456')

    /* ---------- 2. 非平台管理员的边界 ---------- */
    const mine = await api('/tenants/mine', { token: userToken })
    check('租户用户 isSuper=false', mine.result?.isSuper === false, mine.result?.isSuper)
    check('租户用户默认落在自己所属的租户', (mine.result?.tenants ?? []).some(item => Number(item.id) === Number(mine.result?.current)), mine.result?.current)

    // 给临时账号挂上内置 admin 角色，验证「有 admin 角色 ≠ 平台超管」（改造前的核心漏洞）
    const roles = await api('/roles', { token: adminToken })
    const roleRows = Array.isArray(roles.result) ? roles.result : (roles.result?.records ?? [])
    const adminRoleId = roleRows.find(role => role.roleCode === 'admin')?.id
    if (adminRoleId) {
      await api(`/users/${userId}/roles`, { method: 'PUT', token: adminToken, body: { roleIds: [adminRoleId] } })
      const afterRole = await api('/tenants/mine', { token: userToken })
      check('持有 admin 角色的租户用户仍不是平台超管', afterRole.result?.isSuper === false, afterRole.result?.isSuper)
      const stillDenied = await api('/tenants', { token: userToken, tenant: tenantId })
      check('持有 admin 角色也调不动平台级接口', stillDenied.status === 403, stillDenied.status)
    }

    const tenantList = await api('/tenants', { token: userToken, tenant: tenantId })
    check('租户用户调 /tenants 列表被拒（平台级权限）', tenantList.status === 403, tenantList.status)

    const crossTenant = otherTenantId ? await api('/auth/permissions', { token: userToken, tenant: otherTenantId }) : { status: 403 }
    check('租户用户切到不属于自己的租户 → 403', crossTenant.status === 403, crossTenant.status)

    const ghostTenant = await api('/auth/permissions', { token: userToken, tenant: 999999 })
    check('切到不存在的租户 → 403', ghostTenant.status === 403, ghostTenant.status)

    const perms = await api('/auth/permissions', { token: userToken, tenant: tenantId })
    const permList = perms.result?.permissions ?? []
    check('租户用户不会拿到通配权限 *', !permList.includes('*'), permList.slice(0, 5))

    const menuTree = JSON.stringify(perms.result?.menus ?? [])
    check('租户用户的菜单树不含「租户管理」', !menuTree.includes('/system/tenant'))
    check('租户用户的菜单树不含「运维管理」', !menuTree.includes('/ops'))

    /* ---------- 3. 用户列表 / 选人 / 详情 按成员关系收窄 ---------- */
    const scopedUsers = await api('/users?current=1&pageSize=100', { token: adminToken, tenant: tenantId })
    const scopedNames = (scopedUsers.result?.records ?? []).map(row => row.username)
    check('租户 A 的用户列表只含本租户成员', scopedNames.length === 1 && scopedNames[0] === username, scopedNames)

    const platformUsers = await api('/users?current=1&pageSize=100', { token: adminToken })
    const platformNames = (platformUsers.result?.records ?? []).map(row => row.username)
    check('平台视角的用户列表仍能看到多租户账号', platformNames.length > scopedNames.length, `${platformNames.length} vs ${scopedNames.length}`)

    const platformUserId = (platformUsers.result?.records ?? []).find(row => row.username === ADMIN.username)?.id
    const crossDetail = await api(`/users/${platformUserId}`, { token: adminToken, tenant: tenantId })
    check('租户视角查别的租户用户详情 → 404（不泄漏存在性）', crossDetail.status === 404, crossDetail.status)

    /* ---------- 4. 审计日志隔离 ---------- */
    const adminLogs = await api('/logs/login?current=1&pageSize=50', { token: adminToken })
    const scopedLogs = await api('/logs/login?current=1&pageSize=50', { token: adminToken, tenant: tenantId })
    const scopedLogNames = (scopedLogs.result?.records ?? []).map(row => row.operateUserName)
    check('租户视角的登录日志里没有平台管理员记录', !scopedLogNames.includes(ADMIN.username), scopedLogNames.slice(0, 5))
    check('平台视角仍能看到全量登录日志', (adminLogs.result?.records ?? []).length >= (scopedLogs.result?.records ?? []).length)

    /* ---------- 5. 首页概览按租户聚合 ---------- */
    const adminOverview = await api('/dashboard/overview', { token: adminToken })
    const tenantOverview = await api('/dashboard/overview', { token: adminToken, tenant: tenantId })
    const adminRoles = adminOverview.result?.roleTotal?.value ?? adminOverview.result?.roleTotal
    const tenantRoles = tenantOverview.result?.roleTotal?.value ?? tenantOverview.result?.roleTotal
    check('角色数按租户统计（平台 ≠ 租户）', JSON.stringify(adminRoles) !== JSON.stringify(tenantRoles), { adminRoles, tenantRoles })

    // 平台级块（服务器状态）要看的是「租户里的普通账号」，不是带着租户头的平台管理员
    const tenantUserOverview = await api('/dashboard/overview', { token: userToken, tenant: tenantId })
    check('租户普通账号首页不展示平台级系统状态块', tenantUserOverview.result?.serverState === null, tenantUserOverview.result?.serverState)

    /* ---------- 6. 水印策略按租户存 ---------- */
    const platformMark = `平台水印${STAMP}`
    const tenantMark = `租户水印${STAMP}`
    await api('/system/watermark', { method: 'PUT', token: adminToken, body: { content: platformMark } })
    await api('/system/watermark', { method: 'PUT', token: adminToken, tenant: tenantId, body: { content: tenantMark } })

    const platformSetting = await api('/system/watermark', { token: adminToken })
    const tenantSetting = await api('/system/watermark', { token: adminToken, tenant: tenantId })
    check('改租户水印不影响平台默认', platformSetting.result?.content === platformMark, platformSetting.result?.content)
    check('租户读到自己那份水印策略', tenantSetting.result?.content === tenantMark, tenantSetting.result?.content)

    const inheritorRes = await api('/users', { method: 'POST', token: adminToken, body: { username: `iso2_${STAMP}`, realname: '继承测试', password: 'iso123456', status: 1 } })
    const inheritorId = inheritorRes.result?.id
    if (inheritorId) {
      await api(`/tenants/${tenantId}/users`, { method: 'PUT', token: adminToken, body: { userIds: [userId, inheritorId] } })
      const inheritorToken = await login(`iso2_${STAMP}`, 'iso123456')
      const inherited = await api('/users/me/watermark', { token: inheritorToken, tenant: tenantId })
      check('同租户新账号继承该租户的水印策略', JSON.stringify(inherited.result?.lines ?? []).includes('租户水印'), inherited.result?.lines)
      await api(`/users/${inheritorId}`, { method: 'DELETE', token: adminToken })
    }
  } finally {
    /* ---------- 清理 ---------- */
    await api(`/tenants/${tenantId}/users`, { method: 'PUT', token: adminToken, body: { userIds: [] } })
    await api(`/users/${userId}`, { method: 'DELETE', token: adminToken })
    await api(`/tenants/${tenantId}`, { method: 'DELETE', token: adminToken })
    if (otherTenantId) await api(`/tenants/${otherTenantId}`, { method: 'DELETE', token: adminToken })
  }

  console.log(`\n结果：${pass} 项通过，${failures.length} 项失败`)
  if (failures.length) {
    console.log(`失败项：${failures.join(' / ')}`)
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error('\n冒烟中断：', error.message)
  process.exitCode = 1
})
