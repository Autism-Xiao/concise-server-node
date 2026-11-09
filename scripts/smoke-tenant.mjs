/**
 * 多租户冒烟：租户 CRUD / 用户分配 / 切换 / 数据隔离 / 越权 403
 *
 * 前置：需要一个免验证码的测试实例
 *   PORT=3461 CAPTCHA_ENABLED=false node dist/main.js
 * 运行：
 *   node scripts/smoke-tenant.mjs
 *
 * 脚本自己建租户与临时账号，跑完清理（软删租户 + 删除用户及其归属）。
 */
import mysql from 'mysql2/promise'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3461/api/v1'
const DB = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '123456',
  database: process.env.DB_DATABASE ?? 'concise_server'
}

const stamp = Date.now().toString(36)
const CODE_A = `smk_a_${stamp}`
const CODE_B = `smk_b_${stamp}`
const PROBE_ID = `smk_tenant_${stamp}`.slice(0, 32)
const PROBE_USER = `smk_tnt_${stamp}`
const PROBE_PHONE = `139${String(Date.now()).slice(-8)}`

let pass = 0
let fail = 0
const okStatus = status => status === 200 || status === 201
/** 列表接口有两种形态：裸数组（全量）或 Pagination（records） */
const lenOf = res => (Array.isArray(res.data) ? res.data.length : (res.data?.records?.length ?? -1))
const check = (label, ok, extra = '') => {
  if (ok) {
    pass++
    console.log(`PASS  ${label}`)
  } else {
    fail++
    console.log(`FAIL  ${label}${extra ? ` — ${extra}` : ''}`)
  }
}

const conn = await mysql.createConnection(DB)

async function api(path, { method = 'GET', token, tenantId, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (tenantId !== undefined && tenantId !== null) headers['X-Tenant-Id'] = String(tenantId)
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, body: json, data: json?.result ?? json?.data ?? json }
}

async function login(username, password = 'admin123') {
  const res = await api('/auth/login', { method: 'POST', body: { username, password } })
  if (!res.data?.accessToken) throw new Error(`登录失败 ${username}: ${JSON.stringify(res.body).slice(0, 200)}`)
  return res.data.accessToken
}

async function cleanup() {
  await conn.query('DELETE FROM sys_user_tenant WHERE user_id = ? OR tenant_id IN (SELECT id FROM sys_tenant WHERE code IN (?, ?))', [PROBE_ID, CODE_A, CODE_B])
  await conn.query('UPDATE sys_user SET del_flag = 1 WHERE id = ?', [PROBE_ID])
  await conn.query('DELETE FROM sys_tenant WHERE code IN (?, ?)', [CODE_A, CODE_B])
  await conn.query("DELETE FROM sys_dict WHERE dict_code LIKE 'smk_tnt_%'")
}

try {
  // ---------- 准备临时账号（复制 admin 的密码哈希，免验证码实例可直接登录） ----------
  await cleanup()
  const [adminRows] = await conn.query("SELECT * FROM sys_user WHERE username = 'admin' LIMIT 1")
  const row = {
    ...adminRows[0],
    id: PROBE_ID,
    username: PROBE_USER,
    realname: '租户冒烟',
    work_no: `SMK${stamp}`.slice(0, 20),
    email: `${PROBE_USER}@example.com`,
    phone: PROBE_PHONE,
    telephone: null,
    del_flag: 0,
    status: 1,
    login_tenant_id: null,
    // 不能让临时账号继承 admin 的平台管理员标记（整行复制会带过来），否则越权断言全部失真
    is_platform_admin: 0
  }
  const cols = Object.keys(row)
  await conn.query(`INSERT INTO sys_user (${cols.map(c => `\`${c}\``).join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map(c => row[c]))

  const adminToken = await login('admin')

  // ---------- 1. 租户列表 ----------
  const list1 = await api('/tenants?current=1&size=50', { token: adminToken })
  check('GET /tenants 返回分页结构', Array.isArray(list1.data?.records) && typeof list1.data?.total === 'number', JSON.stringify(list1.body).slice(0, 160))
  check('列表含默认租户', (list1.data?.records ?? []).some(item => item.code === 'default'))

  // ---------- 2. 创建租户 ----------
  const createA = await api('/tenants', {
    method: 'POST',
    token: adminToken,
    body: { name: '冒烟租户A', code: CODE_A, contact: '张三', phone: '13800000001', plan: 'standard', expireAt: '2099-12-31' }
  })
  check('创建租户 A 成功', okStatus(createA.status) && createA.data?.id > 0, JSON.stringify(createA.body).slice(0, 200))
  const tenantA = createA.data?.id

  const dup = await api('/tenants', { method: 'POST', token: adminToken, body: { name: '重复编码', code: CODE_A } })
  check('重复编码被拒（400）', dup.status === 400 || dup.body?.code === 400, JSON.stringify(dup.body).slice(0, 160))

  const createB = await api('/tenants', { method: 'POST', token: adminToken, body: { name: '冒烟租户B', code: CODE_B, plan: 'trial' } })
  const tenantB = createB.data?.id
  check('创建租户 B 成功', okStatus(createB.status) && tenantB > 0)

  // ---------- 3. 分配用户 ----------
  const assignA = await api(`/tenants/${tenantA}/users`, { method: 'PUT', token: adminToken, body: { userIds: [PROBE_ID] } })
  check('把临时账号分配到租户 A', okStatus(assignA.status) && assignA.data?.added === 1, JSON.stringify(assignA.body).slice(0, 160))

  const usersA = await api(`/tenants/${tenantA}/users`, { token: adminToken })
  check('租户 A 用户列表含该账号', (usersA.data?.records ?? []).some(item => item.id === PROBE_ID))

  // ---------- 4. 临时账号视角 ----------
  const probeToken = await login(PROBE_USER)
  const mine = await api('/tenants/mine', { token: probeToken })
  check('mine 只返回自己所属租户', (mine.data?.tenants ?? []).length === 1 && mine.data?.tenants?.[0]?.id === tenantA, JSON.stringify(mine.body).slice(0, 200))
  check('默认当前租户 = A', mine.data?.current === tenantA)

  const forbidden = await api('/tenants/mine', { token: probeToken, tenantId: tenantB })
  check('带未加入的租户头 → 403', forbidden.status === 403, `status=${forbidden.status} ${JSON.stringify(forbidden.body).slice(0, 120)}`)

  // ---------- 4.5 超管视角：全部租户 + 平台视角 ----------
  const adminMine = await api('/tenants/mine', { token: adminToken })
  check('超管 mine 标记 isSuper', adminMine.data?.isSuper === true, JSON.stringify(adminMine.body).slice(0, 160))
  const adminTenantIds = (adminMine.data?.tenants ?? []).map(item => item.id)
  check('超管 mine 列出全部租户（含 A/B）', adminTenantIds.includes(tenantA) && adminTenantIds.includes(tenantB))

  // 回归：mine 必须反映「本次请求实际生效的租户」。
  // 曾经的 bug —— mine 内部又调了一次 resolveTenant()，拿不到 X-Tenant-Id，
  // 超管一律被算成平台视角，前端切换器就永远显示「平台视角」、并把该项置灰（点了没反应）。
  const adminMineInA = await api('/tenants/mine', { token: adminToken, tenantId: tenantA })
  check(
    '超管带租户头时 mine.current = 该租户',
    adminMineInA.data?.current === tenantA,
    `current=${adminMineInA.data?.current} tenantA=${tenantA}`
  )

  const backPlatform = await api('/tenants/switch', { method: 'POST', token: adminToken, body: { tenantId: 0 } })
  check('超管切回平台视角（tenantId=null）', backPlatform.data?.tenantId === null, JSON.stringify(backPlatform.body).slice(0, 160))

  const probePlatform = await api('/tenants/switch', { method: 'POST', token: probeToken, body: { tenantId: 0 } })
  check('普通用户切平台视角被拒（400）', probePlatform.status === 400 || probePlatform.body?.code === 400, JSON.stringify(probePlatform.body).slice(0, 160))

  // ---------- 5. 数据隔离 ----------
  const dictsAEmpty = await api('/dicts', { token: adminToken, tenantId: tenantA })
  const emptyLen = lenOf(dictsAEmpty)
  check('租户 A 初始看不到默认租户的字典', emptyLen === 0, `len=${emptyLen} ${JSON.stringify(dictsAEmpty.body).slice(0, 120)}`)

  const createDict = await api('/dicts', {
    method: 'POST',
    token: adminToken,
    tenantId: tenantA,
    body: { dictCode: `smk_tnt_${stamp}`, dictName: '租户A字典', type: 0 }
  })
  check('超管进入租户 A 建字典成功', createDict.status === 200 || createDict.status === 201, JSON.stringify(createDict.body).slice(0, 200))

  const [dictRows] = await conn.query('SELECT tenant_id FROM sys_dict WHERE dict_code = ?', [`smk_tnt_${stamp}`])
  check('新字典被打上租户 A 标记', Number(dictRows[0]?.tenant_id) === tenantA, JSON.stringify(dictRows))

  const dictsA = await api('/dicts', { token: adminToken, tenantId: tenantA })
  check('租户 A 现在只看得到自己的 1 条字典', lenOf(dictsA) === 1, `len=${lenOf(dictsA)}`)

  const dictsB = await api('/dicts', { token: adminToken, tenantId: tenantB })
  check('租户 B 看不到租户 A 的字典', lenOf(dictsB) === 0, `len=${lenOf(dictsB)}`)

  const dictsAdmin = await api('/dicts', { token: adminToken })
  const adminRecords = Array.isArray(dictsAdmin.data) ? dictsAdmin.data : (dictsAdmin.data?.records ?? [])
  check(
    '超管（不带租户头）能看到所有租户的字典',
    adminRecords.some(item => item.dictCode === `smk_tnt_${stamp}`) && adminRecords.some(item => item.dictCode === 'sys_user_gender'),
    `len=${adminRecords.length}`
  )

  // ---------- 6. 切换租户 ----------
  const switched = await api('/tenants/switch', { method: 'POST', token: probeToken, body: { tenantId: tenantA } })
  check('切换租户 A 成功', okStatus(switched.status) && switched.data?.tenantId === tenantA, JSON.stringify(switched.body).slice(0, 160))
  const [prefRows] = await conn.query('SELECT login_tenant_id FROM sys_user WHERE id = ?', [PROBE_ID])
  check('切换后被记住（login_tenant_id）', Number(prefRows[0]?.login_tenant_id) === tenantA)

  // ---------- 7. 删除保护 ----------
  const delBusy = await api(`/tenants/${tenantA}`, { method: 'DELETE', token: adminToken })
  check('租户下有用户时禁止删除', delBusy.status === 400 || delBusy.body?.code === 400, JSON.stringify(delBusy.body).slice(0, 160))

  const delDefault = await api('/tenants/1', { method: 'DELETE', token: adminToken })
  check('默认租户不可删除', delDefault.status === 400 || delDefault.body?.code === 400)

  // ---------- 8. 移除用户后可删 ----------
  const assignNone = await api(`/tenants/${tenantA}/users`, { method: 'PUT', token: adminToken, body: { userIds: [] } })
  check('清空租户 A 的成员', okStatus(assignNone.status) && assignNone.data?.removed === 1, JSON.stringify(assignNone.body).slice(0, 160))
  const delOk = await api(`/tenants/${tenantA}`, { method: 'DELETE', token: adminToken })
  check('成员清空后删除租户成功', okStatus(delOk.status), JSON.stringify(delOk.body).slice(0, 160))
} finally {
  await cleanup()
  await conn.end()
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`)
process.exit(fail === 0 ? 0 : 1)
