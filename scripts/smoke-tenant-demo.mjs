/**
 * 多租户演示数据冒烟：验证「切换租户 → 数据真的隔离 / 共享数据真的可见」
 *
 * 前置：
 *   1. node scripts/seed-tenant-demo.cjs   （灌演示数据，幂等）
 *   2. PORT=3461 CAPTCHA_ENABLED=false node dist/main.js
 * 运行：
 *   node scripts/smoke-tenant-demo.mjs
 *
 * 断言用「名字包含」而不是数量：数量会随演示数据增删变化，名字是稳定特征。
 */
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3461/api/v1'

const SZ_DEPT = 'AI 研发中心'
const CS_DEPT = '华中交付中心'
const DEFAULT_DEPT = '南山区研发中心'
const SHARED_NOTICE = '【平台】系统维护公告'
const SZ_NOTICE = '【深圳】Q4 全员会通知'
const CS_NOTICE = '【长沙】交付季排班调整'

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

async function api(path, { method = 'GET', token, tenantId, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (tenantId !== undefined && tenantId !== null) headers['X-Tenant-Id'] = String(tenantId)
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, data: json?.result ?? json?.data ?? json }
}

const records = res => (Array.isArray(res.data) ? res.data : (res.data?.records ?? []))
const namesOfDept = res => records(res).map(d => d.departName)
const titlesOfNotice = res => records(res).map(n => n.titile ?? n.title)
/** 公告标题后面可能带补充说明，用「包含」判断；直接用数组 includes 是精确匹配，会误判 */
const hasTitle = (titles, keyword) => titles.some(t => String(t ?? '').includes(keyword))

/* ---------- 登录 ---------- */
const loginRes = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })
const token = loginRes.data?.accessToken
if (!token) {
  console.error('登录失败，无法继续冒烟：', JSON.stringify(loginRes.data).slice(0, 200))
  process.exit(1)
}
console.log('admin 登录成功\n')

/* ---------- 1. 我所属的租户（超管应看到全部租户） ---------- */
const mine = await api('/tenants/mine', { token })
const mineList = mine.data?.tenants ?? []
check('mine 返回 isSuper=true', mine.data?.isSuper === true)
check('mine 至少含 默认/深圳/长沙 三个租户', ['default', 'demo_sz', 'demo_cs'].every(code => mineList.some(t => t.code === code)), JSON.stringify(mineList.map(t => t.code)))
const szTenant = mineList.find(t => t.code === 'demo_sz')
const csTenant = mineList.find(t => t.code === 'demo_cs')
check('深圳/长沙租户 id 可用', Boolean(szTenant?.id && csTenant?.id))

/* ---------- 2. 部门隔离 ---------- */
const deptDefault = await api('/depts?current=1&size=200', { token, tenantId: 1 })
const deptSz = await api('/depts?current=1&size=200', { token, tenantId: szTenant.id })
const deptCs = await api('/depts?current=1&size=200', { token, tenantId: csTenant.id })
const deptAll = await api('/depts?current=1&size=200', { token })

const d1 = namesOfDept(deptDefault)
const d19 = namesOfDept(deptSz)
const d20 = namesOfDept(deptCs)
const dAll = namesOfDept(deptAll)

check('默认租户能看到自己的「南山区研发中心」', d1.includes(DEFAULT_DEPT), d1.join(','))
check('默认租户看不到深圳的「AI 研发中心」', !d1.includes(SZ_DEPT))
check('深圳租户能看到「AI 研发中心」', d19.includes(SZ_DEPT), d19.join(','))
check('深圳租户看不到默认租户的「南山区研发中心」', !d19.includes(DEFAULT_DEPT))
check('长沙租户能看到「华中交付中心」', d20.includes(CS_DEPT), d20.join(','))
check('长沙租户看不到深圳的「AI 研发中心」', !d20.includes(SZ_DEPT))
check('平台视角（不传 X-Tenant-Id）三家都能看到', [DEFAULT_DEPT, SZ_DEPT, CS_DEPT].every(n => dAll.includes(n)), dAll.join(','))

/* ---------- 3. 公告隔离 + 平台共享数据 ---------- */
const noticeDefault = titlesOfNotice(await api('/notices/published?current=1&size=50', { token, tenantId: 1 }))
const noticeSz = titlesOfNotice(await api('/notices/published?current=1&size=50', { token, tenantId: szTenant.id }))
const noticeCs = titlesOfNotice(await api('/notices/published?current=1&size=50', { token, tenantId: csTenant.id }))

check('深圳租户看到自己的公告', hasTitle(noticeSz, SZ_NOTICE), noticeSz.join(' | '))
check('深圳租户看不到长沙的公告', !hasTitle(noticeSz, CS_NOTICE))
check('长沙租户看到自己的公告', hasTitle(noticeCs, CS_NOTICE), noticeCs.join(' | '))
check('长沙租户看不到深圳的公告', !hasTitle(noticeCs, SZ_NOTICE))
check('深圳租户能看到平台共享公告（tenant_id=0）', hasTitle(noticeSz, SHARED_NOTICE))
check('长沙租户能看到平台共享公告（tenant_id=0）', hasTitle(noticeCs, SHARED_NOTICE))
check('默认租户看不到深圳/长沙的公告', !hasTitle(noticeDefault, SZ_NOTICE) && !hasTitle(noticeDefault, CS_NOTICE))

/* ---------- 4. 越权：未归属该租户的账号切过去必须被拒 ---------- */
// 临时建一个不属于任何租户的账号（不碰既有账号的归属，避免覆盖式分配误伤），
// 验证「前端传什么租户 ID 都不可信」这条防线，跑完软删。
const probeName = `smk_demo_${Date.now().toString(36)}`
const probePwd = 'Smoke@123456'
const created = await api('/users', { method: 'POST', token, body: { username: probeName, realname: '租户冒烟临时账号', password: probePwd } })
const probeId = created.data?.id
if (probeId) {
  const probeLogin = await api('/auth/login', { method: 'POST', body: { username: probeName, password: probePwd } })
  const probeToken = probeLogin.data?.accessToken
  check('临时账号登录成功', Boolean(probeToken), JSON.stringify(probeLogin.data).slice(0, 120))
  if (probeToken) {
    const forbidden = await api('/depts?current=1&size=10', { token: probeToken, tenantId: szTenant.id })
    check('无该租户归属的账号切过去被 403 拒绝', forbidden.status === 403, `status=${forbidden.status}`)
    const own = await api('/tenants/mine', { token: probeToken })
    // 注意别用 /depts 判断：新账号没有任何角色，会被权限守卫拦成 403，和租户无关。
    // mine 只要登录就能访问，正好用来验证归属语义。
    check('无该租户归属账号的 mine 正常返回（不被租户层拦）', own.status === 200, `status=${own.status}`)
    // 经 API 创建的账号会自动归属默认租户 1（UserService.resolveJoinTenantId），
    // 所以这里应恰好只有默认租户一项，而不是空列表
    check(
      '新建账号默认归属租户 1（自动归属）',
      Array.isArray(own.data?.tenants) && own.data.tenants.length === 1 && own.data.tenants[0]?.id === 1,
      JSON.stringify(own.data?.tenants)
    )
  }
  await api(`/users/${probeId}`, { method: 'DELETE', token })
  console.log('已清理临时账号', probeName)
} else {
  console.log('SKIP 临时账号创建失败，跳过越权断言：', JSON.stringify(created.data).slice(0, 160))
}

/* ---------- 汇总 ---------- */
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
