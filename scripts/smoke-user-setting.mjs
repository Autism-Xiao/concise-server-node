/**
 * 用户界面设置冒烟：读写 / 白名单裁剪 / 合并语义 / 体积上限 / 未登录
 *
 * 前置：需要一个免验证码的测试实例
 *   PORT=3461 CAPTCHA_ENABLED=false node dist/main.js
 * 运行：
 *   node scripts/smoke-user-setting.mjs
 *
 * 脚本会先清掉 admin 的设置行再跑，跑完把 admin 的设置恢复成初始状态（删行）。
 * 用的是 admin 自己的记录，不新建账号，避免留垃圾数据。
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

const conn = await mysql.createConnection(DB)

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, body: json, data: json?.result ?? json?.data ?? json }
}

async function login(username, password = 'admin123') {
  const res = await api('/auth/login', { method: 'POST', body: { username, password } })
  if (!res.data?.accessToken) throw new Error(`登录失败 ${username}: ${JSON.stringify(res.body).slice(0, 200)}`)
  return { token: res.data.accessToken, id: res.data.user?.id }
}

const PATH = '/users/me/settings'

try {
  const { token } = await login('admin')
  // 设置表主键是 user_id，admin 的 id 从库里查，别写死
  const [adminRows] = await conn.query("SELECT id FROM sys_user WHERE username = 'admin' AND del_flag = 0 LIMIT 1")
  if (!adminRows.length) throw new Error('找不到 admin 账号')
  const ADMIN_ID = adminRows[0].id

  // ---------- 0. 清历史数据，保证从「未设置」开始 ----------
  await conn.query('DELETE FROM sys_user_setting WHERE user_id = ?', [ADMIN_ID])

  // ---------- 1. 未登录 ----------
  const anon = await api(PATH)
  check('未登录读取 → 401', anon.status === 401, `status=${anon.status}`)

  // ---------- 2. 未设置过 ----------
  const empty = await api(PATH, { token })
  // C 方案后：库里没有行也下发后端默认值（8 项齐全），不再返回 null
  check(
    '未设置 → 下发默认值（direction=ltr / themeColor=default）',
    empty.status === 200 && empty.data.settings?.direction === 'ltr' && empty.data.settings?.themeColor === 'default',
    JSON.stringify(empty.body).slice(0, 200)
  )
  check('未设置 → updatedAt 为 null', empty.data.updatedAt === null)

  // ---------- 3. 首次写入 + 白名单裁剪 ----------
  const first = await api(PATH, {
    method: 'PUT',
    token,
    body: { settings: { fontSize: 'large', themeColor: 'blue', grayscale: true, hackKey: 'should-drop', direction: 'bad' } }
  })
  const s1 = first.data.settings ?? {}
  check('写入成功（200）', first.status === 200, `status=${first.status}`)
  check('合法键落库 fontSize', s1.fontSize === 'large')
  check('合法键落库 themeColor', s1.themeColor === 'blue')
  check('布尔键落库 grayscale', s1.grayscale === true)
  check('未知键被丢弃', !('hackKey' in s1))
  // 非法值丢弃后下发时回落到后端默认值 ltr，而不是把 bad 带出去
  check('非法枚举值被丢弃（direction 回落 ltr）', s1.direction === 'ltr', s1.direction)
  check('返回 updatedAt 为数字', typeof first.data.updatedAt === 'number')

  // ---------- 4. 合并语义：只传一项不冲掉其它 ----------
  const merged = await api(PATH, { method: 'PUT', token, body: { settings: { fontSize: 'small' } } })
  const s2 = merged.data.settings ?? {}
  check('合并后 fontSize 更新', s2.fontSize === 'small')
  check('合并后 themeColor 保留', s2.themeColor === 'blue')
  check('合并后 grayscale 保留', s2.grayscale === true)

  // ---------- 5. 全是非法键 → 不产生空写，返回旧值 ----------
  const noop = await api(PATH, { method: 'PUT', token, body: { settings: { unknownA: 1, direction: 'xxx' } } })
  check('全非法键时返回旧值', noop.data.settings?.fontSize === 'small' && noop.data.settings?.themeColor === 'blue')

  // ---------- 6. 体积上限 ----------
  const huge = await api(PATH, { method: 'PUT', token, body: { settings: { themeColor: 'a'.repeat(5000) } } })
  check('超过 4KB → 400', huge.status === 400, `status=${huge.status}`)

  // ---------- 7. 落库形态 ----------
  const [rows] = await conn.query('SELECT user_id, settings, update_time FROM sys_user_setting WHERE user_id = ?', [ADMIN_ID])
  check('库里只有一行（主键 upsert）', rows.length === 1, `rows=${rows.length}`)
  const stored = rows[0] ? JSON.parse(rows[0].settings) : {}
  check('落库内容无未知键', !('hackKey' in stored))
  check('落库 update_time 非空', !!rows[0]?.update_time)

  // ---------- 8. 账号隔离：换一个账号读不到 admin 的设置 ----------
  const [guestRows] = await conn.query("SELECT id FROM sys_user WHERE username = 'guest' AND del_flag = 0 LIMIT 1")
  if (guestRows.length) {
    try {
      const guest = await login('guest', 'guest123')
      await conn.query('DELETE FROM sys_user_setting WHERE user_id = ?', [guestRows[0].id])
      const guestGet = await api(PATH, { token: guest.token })
      check('另一个账号读到的是自己的空设置', guestGet.data.settings === null, JSON.stringify(guestGet.body).slice(0, 120))
      await conn.query('DELETE FROM sys_user_setting WHERE user_id = ?', [guestRows[0].id])
    } catch (error) {
      console.log(`SKIP  guest 登录失败（密码可能已改）：${error?.message ?? error}`)
    }
  } else {
    console.log('SKIP  guest 账号不存在，跳过账号隔离断言')
  }
} catch (error) {
  fail++
  console.log(`ERROR ${error?.message ?? error}`)
} finally {
  await conn.query("DELETE FROM sys_user_setting WHERE user_id IN (SELECT id FROM sys_user WHERE username = 'admin')").catch(() => undefined)
  await conn.end().catch(() => undefined)
  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`)
  process.exit(fail ? 1 : 0)
}
