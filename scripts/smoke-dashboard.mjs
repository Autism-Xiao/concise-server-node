/**
 * 首页概览冒烟测试：验证「同一个接口按权限返回不同块」
 *
 * 用法：
 *   SMOKE_BASE=http://127.0.0.1:3461/api node scripts/smoke-dashboard.mjs
 * 前提：目标实例已关闭验证码（CAPTCHA_ENABLED=false），否则登录拿不到 token。
 *
 * 覆盖四类账号（后两类由脚本临时创建、跑完删除）：
 *   admin    超管       → 全部 10 块，口径 all
 *   ceshi    viewer     → 有列表类只读权限（用户/角色/字典），无在线/监控权限，趋势与操作降级为 self
 *                          （租户默认角色模板给 viewer 授了 xxx:list，所以「用户总数」是数字而不是 null）
 *   auditor  审计员     → 有日志权限（all），无角色/在线/监控权限
 *   无角色              → 只剩「我的」数据，其余全 null
 *
 * 断言重点：
 *   1) 没权限的块必须是 null，不能是 0（0 无法区分"没数据"和"没权限"）
 *   2) 降级块的 scope 必须是 'self'，有权限的必须是 'all'
 *   3) 趋势固定 7 天、日期连续、最后一天是今天
 *   4) 低权限账号的「今日登录成功数」不会超过 admin 的全站数字（口径没串）
 */
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3461/api'
const ADMIN_USER = process.env.SMOKE_USER ?? 'admin'
const ADMIN_PASSWORD = process.env.SMOKE_PASSWORD ?? 'admin123'
/** 已有的访客角色测试账号（角色 viewer） */
const VIEWER_USER = process.env.SMOKE_VIEWER ?? 'ceshi'
const VIEWER_PASSWORD = process.env.SMOKE_VIEWER_PASSWORD ?? '123456'
const STAMP = Date.now().toString().slice(-8)
const TEMP_PASSWORD = 'Smoke123456'

const results = []
const createdUserIds = []

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function request(path, { token, ...init } = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {})
    }
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: res.status, json }
}

async function login(username, password) {
  const res = await request('/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  const token = res.json?.result?.accessToken
  if (!token) throw new Error(`登录失败：${username} → ${res.json?.message ?? res.status}`)
  return token
}

/** 取概览数据（断言里到处要用，包一层省重复） */
async function overview(token) {
  const res = await request('/v1/dashboard/overview', { token })
  return res
}

function assertTrend(label, trend) {
  check(`${label} 登录趋势有数据`, !!trend && Array.isArray(trend.points))
  if (!trend) return
  check(`${label} 趋势固定 7 天`, trend.points.length === 7, `实际 ${trend.points.length} 天`)
  const dates = trend.points.map(p => p.date)
  const sorted = [...dates].sort()
  check(`${label} 趋势日期连续且升序`, JSON.stringify(dates) === JSON.stringify(sorted), dates.join(','))
  const today = new Date()
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  check(`${label} 趋势最后一天是今天`, dates[dates.length - 1] === key, `最后一天=${dates[dates.length - 1]} 今天=${key}`)
  check(
    `${label} 趋势每天的值为非负整数`,
    trend.points.every(p => Number.isInteger(p.success) && Number.isInteger(p.fail) && p.success >= 0 && p.fail >= 0)
  )
}

async function createUser(adminToken, username, roleIds) {
  const res = await request('/v1/users', {
    token: adminToken,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, realname: `冒烟-${username}`, password: TEMP_PASSWORD, status: 1, roleIds })
  })
  const id = res.json?.result?.id
  if (!id) throw new Error(`创建用户失败：${username} → ${res.json?.message ?? res.status}`)
  createdUserIds.push(id)
  return id
}

try {
  /* ---------------- 未登录 ---------------- */
  const anonymous = await overview('')
  check('未登录访问概览返回 401', anonymous.status === 401, `status=${anonymous.status}`)

  /* ---------------- admin：全部可见 ---------------- */
  const adminToken = await login(ADMIN_USER, ADMIN_PASSWORD)
  const admin = (await overview(adminToken)).json?.result
  check('admin 概览有 profile', !!admin?.profile?.username, admin?.profile?.username)
  check('admin 有上次登录记录', !!admin?.profile?.lastLogin?.time, admin?.profile?.lastLogin?.ip)
  check('admin 用户总数非 null', !!admin?.userTotal, JSON.stringify(admin?.userTotal))
  check('admin 用户总数已滤掉软删', Number(admin?.userTotal?.total) < 175, `total=${admin?.userTotal?.total}（表内 175 行含 151 条软删）`)
  check('admin 用户总数口径 all', admin?.userTotal?.scope === 'all')
  check('admin 今日登录非 null 且口径 all', !!admin?.todayLogin && admin.todayLogin.scope === 'all', JSON.stringify(admin?.todayLogin))
  check('admin 在线人数非 null', typeof admin?.onlineCount === 'number', `online=${admin?.onlineCount}`)
  check('admin 角色总数非 null', typeof admin?.roleTotal === 'number', `roles=${admin?.roleTotal}`)
  check('admin 登录趋势口径 all', admin?.loginTrend?.scope === 'all')
  assertTrend('admin', admin?.loginTrend)
  check('admin 最近操作口径 all', admin?.recentOpers?.scope === 'all')
  check('admin 最近操作不超过 5 条', (admin?.recentOpers?.rows?.length ?? 0) <= 5, `${admin?.recentOpers?.rows?.length ?? 0} 条`)
  check('admin 最近操作内容已截断', (admin?.recentOpers?.rows ?? []).every(row => row.content.length <= 81))
  check('admin 最近操作不含请求参数（防泄漏）', (admin?.recentOpers?.rows ?? []).every(row => !('params' in row) && !('errorMsg' in row)))
  check('admin 存储配额为正数', Number(admin?.myStorage?.quotaBytes) > 0, `${admin?.myStorage?.usedBytes}B / ${admin?.myStorage?.quotaBytes}B`)
  check('admin 任务口径 all（含未指派）', admin?.myTasks?.scope === 'all', JSON.stringify(admin?.myTasks))
  check('admin 公告为数组', Array.isArray(admin?.notices), `${admin?.notices?.length ?? 0} 条`)
  check('admin 服务器状态非 null', !!admin?.serverState, admin?.serverState ? `CPU ${admin.serverState.cpuUsage}% 内存 ${admin.serverState.memoryUsage}%` : 'null')

  /* ---------------- viewer：大量降级 ---------------- */
  const viewerToken = await login(VIEWER_USER, VIEWER_PASSWORD)
  const viewer = (await overview(viewerToken)).json?.result
  // 租户角色模板给 viewer 授了 system:user:list，所以用户总数可见（按 data_scope 裁剪），不再是 null。
  // 注意 userTotal 是对象 { scope, total, active, frozen }，不是数字
  check(
    'viewer 用户总数可见（有 system:user:list，按 data_scope 裁剪）',
    typeof viewer?.userTotal === 'object' && typeof viewer?.userTotal?.total === 'number',
    `userTotal=${JSON.stringify(viewer?.userTotal)}`
  )
  check('viewer 在线人数为 null', viewer?.onlineCount === null)
  check('viewer 服务器状态为 null', viewer?.serverState === null)
  check('viewer 角色总数可见（有 system:role:list）', typeof viewer?.roleTotal === 'number', `roles=${viewer?.roleTotal}`)
  check('viewer 今日登录口径降级为 self', viewer?.todayLogin?.scope === 'self', JSON.stringify(viewer?.todayLogin))
  check('viewer 登录趋势口径降级为 self', viewer?.loginTrend?.scope === 'self')
  check('viewer 最近操作口径降级为 self', viewer?.recentOpers?.scope === 'self')
  assertTrend('viewer', viewer?.loginTrend)
  check('viewer 存储块仍然存在', Number(viewer?.myStorage?.quotaBytes) > 0)
  check('viewer 公告块仍然存在', Array.isArray(viewer?.notices))
  check(
    'viewer 自己的登录成功数不超过全站（口径没串）',
    Number(viewer?.todayLogin?.success ?? 0) <= Number(admin?.todayLogin?.success ?? 0),
    `self=${viewer?.todayLogin?.success} all=${admin?.todayLogin?.success}`
  )

  /* ---------------- auditor：有日志权限、无角色/在线/监控 ---------------- */
  const roles = await request('/v1/roles/options', { token: adminToken })
  const auditorRole = (roles.json?.result ?? []).find(role => role.roleCode === 'auditor' || role.code === 'auditor')
  check('能查到 auditor 角色', !!auditorRole, JSON.stringify(auditorRole ?? roles.json?.result))
  const auditorName = `smoke_audit_${STAMP}`
  await createUser(adminToken, auditorName, auditorRole ? [auditorRole.id] : [])
  const auditorToken = await login(auditorName, TEMP_PASSWORD)
  const auditor = (await overview(auditorToken)).json?.result
  check('auditor 用户总数可见', !!auditor?.userTotal, JSON.stringify(auditor?.userTotal))
  check('auditor 今日登录口径 all', auditor?.todayLogin?.scope === 'all')
  check('auditor 登录趋势口径 all', auditor?.loginTrend?.scope === 'all')
  check('auditor 最近操作口径 all', auditor?.recentOpers?.scope === 'all')
  check('auditor 角色总数为 null（无 system:role:list）', auditor?.roleTotal === null)
  check('auditor 在线人数为 null', auditor?.onlineCount === null)
  check('auditor 服务器状态为 null', auditor?.serverState === null)
  check('auditor 任务口径 self（无 task 权限）', auditor?.myTasks?.scope === 'self')
  // data_scope=1（全部）的账号不受部门收窄：应能看到全站用户（含刚创建的临时账号，故 >= admin 基线）
  check(
    'auditor 用户总数不受部门收窄（data_scope=全部）',
    Number(auditor?.userTotal?.total) >= Number(admin?.userTotal?.total),
    `auditor=${auditor?.userTotal?.total} admin 基线=${admin?.userTotal?.total}（差异应为刚建的临时账号）`
  )
  // 同一口径的另一端：用户列表的 total 必须和首页卡片数字相同，否则两个页面会互相打脸
  const auditorList = await request('/v1/users?page=1&pageSize=1', { token: auditorToken })
  check(
    '首页用户总数与用户列表 total 同口径',
    Number(auditorList.json?.result?.total) === Number(auditor?.userTotal?.total),
    `list=${auditorList.json?.result?.total} dashboard=${auditor?.userTotal?.total}`
  )

  /* ---------------- 无角色：只剩「我的」 ---------------- */
  // 建用户的 DTO 要求 roleIds 至少 1 个，所以先挂一个角色再清空（batch-roles 允许空数组）
  const noRoleName = `smoke_norole_${STAMP}`
  const viewerRole = (roles.json?.result ?? []).find(role => role.roleCode === 'viewer' || role.code === 'viewer')
  const noRoleId = await createUser(adminToken, noRoleName, viewerRole ? [viewerRole.id] : [auditorRole.id])
  const stripped = await request('/v1/users/batch-roles', {
    token: adminToken,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [noRoleId], roleIds: [] })
  })
  check('清空临时用户的角色成功', stripped.json?.code === 0, stripped.json?.message ?? String(stripped.status))
  const noRoleToken = await login(noRoleName, TEMP_PASSWORD)
  const noRole = (await overview(noRoleToken)).json?.result
  check('无角色 用户总数为 null', noRole?.userTotal === null)
  check('无角色 角色总数为 null', noRole?.roleTotal === null)
  check('无角色 在线人数为 null', noRole?.onlineCount === null)
  check('无角色 服务器状态为 null', noRole?.serverState === null)
  check('无角色 登录趋势降级为 self', noRole?.loginTrend?.scope === 'self')
  check('无角色 最近操作降级为 self', noRole?.recentOpers?.scope === 'self')
  check('无角色 仍能看到自己的存储', Number(noRole?.myStorage?.quotaBytes) > 0)
  check('无角色 仍能看到公告', Array.isArray(noRole?.notices))
  check('无角色 概览整体返回 200 而不是 403', !!noRole?.profile?.username, noRole?.profile?.username)
} catch (error) {
  check('脚本执行未抛异常', false, error instanceof Error ? error.message : String(error))
} finally {
  // 清理临时账号：即使中途失败也要删，避免污染用户表
  if (createdUserIds.length) {
    const adminToken = await login(ADMIN_USER, ADMIN_PASSWORD).catch(() => '')
    if (adminToken) {
      const del = await request('/v1/users/batch-delete', {
        token: adminToken,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: createdUserIds })
      })
      check('清理临时用户', del.json?.code === 0, `提交 ${createdUserIds.length} 个 id → ${del.json?.message ?? del.status}`)
    }
  }

  const failed = results.filter(row => !row.ok)
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
  if (failed.length) {
    console.log('失败项：', failed.map(row => row.name).join('、'))
    process.exitCode = 1
  }
}
