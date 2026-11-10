/**
 * 滑块验证码冒烟（18 项）
 *
 * 覆盖：出图结构与尺寸、答案取值范围、位置校验与容差边界、挑战一次性、ticket 一次性消费。
 * 答案 x 直接从 Redis 读取（与出图同源），因此能确定性地验证「图上缺口位置 = 校验期望位置」。
 *
 * 前置：后端实例（PORT=3461）与 Redis 可用，且必须开启 CAPTCHA_ENABLED（其余冒烟脚本用的是 false，
 * 因为关掉开关后登录不再校验 ticket，本脚本「不带 ticket 被拒」等断言就失去意义）。
 *   $env:PORT="3461"; $env:CAPTCHA_ENABLED="true"; node dist/main.js
 *   node scripts/smoke-captcha.mjs
 *
 * 开关没开时会自动以退出码 2 中止（而不是刷一串看不懂的 FAIL），避免误判为代码回归。
 */
import Redis from 'ioredis'

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3461/api/v1'
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin123'
const redis = new Redis({
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  lazyConnect: false
})

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` | ${extra}` : ''}`)
}

const api = async (path, init) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text.slice(0, 200) }
  }
  return { status: res.status, json }
}

/** 从 PNG dataURL 里读宽高（IHDR 在第 16..24 字节） */
const pngSize = dataUrl => {
  const b = Buffer.from(dataUrl.split(',')[1], 'base64')
  const isPng = b.subarray(1, 4).toString() === 'PNG'
  return { isPng, width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

const answerOf = async captchaId => {
  const raw = await redis.get(`captcha:${captchaId}`)
  return raw ? JSON.parse(raw).x : null
}

const newChallenge = async () => {
  const res = await api('/auth/captcha')
  return res.json.result
}

// 前置：CAPTCHA_ENABLED=false 时登录根本不看 ticket，后面「不带 ticket 被拒」等断言必然假失败。
// 用一次裸登录探针判断开关，而不是读环境变量——脚本连的是远端实例时环境变量靠不住。
const probe = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }) })
if (probe.json.code === 0) {
  console.error('\n[前置失败] 不带 ticket 竟然登录成功 → 当前实例 CAPTCHA_ENABLED=false')
  console.error('请用下面的命令重启后再跑：$env:PORT="3461"; $env:CAPTCHA_ENABLED="true"; node dist/main.js')
  await redis.quit()
  process.exit(2)
}
if (!String(probe.json.message ?? '').includes('滑块')) {
  console.warn(`[提示] 探针不是被验证码拦下的（${probe.json.message}），请确认账号 ${ADMIN_USERNAME} 密码可用`)
}

console.log('--- 出图 ---')
const firstRes = await api('/auth/captcha')
const first = firstRes.json.result
// 实例太旧（没有滑块验证码）时 result 为 null，后面会以 TypeError 崩在半路，先给一句人能看懂的话
if (!first?.bgUrl) {
  console.error(`\n[前置失败] /auth/captcha 没有返回出图数据（HTTP ${firstRes.status}，${firstRes.json.message ?? JSON.stringify(firstRes.json)?.slice(0, 120)}）`)
  console.error(
    firstRes.status === 429
      ? '被限流了，等一分钟再跑；反复跑本脚本会触发 /auth/captcha 的频率限制'
      : '$env:PORT="3457"; $env:CAPTCHA_ENABLED="true"; node scripts/serve.mjs 起一个最新实例再跑'
  )
  await redis.quit()
  process.exit(3)
}
check('GET /auth/captcha 返回 code 0', firstRes.json.code === 0, firstRes.json.message)
check('captchaId 是 UUID', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(first.captchaId), first.captchaId)
check('bgUrl 是 PNG dataURL', first.bgUrl.startsWith('data:image/png;base64,'))

const bg = pngSize(first.bgUrl)
const piece = pngSize(first.puzzleUrl)
check('背景图 320x160', bg.isPng && bg.width === 320 && bg.height === 160, `${bg.width}x${bg.height}`)
check('拼图块 60x160（1:1 显示，缩放会让 x 校验错位）', piece.isPng && piece.width === 60 && piece.height === 160, `${piece.width}x${piece.height}`)

const xs = []
for (let i = 0; i < 12; i++) {
  const c = await newChallenge()
  xs.push(await answerOf(c.captchaId))
}
check('答案 x 全部落在 [110,250]（左界大于拼图块宽度，避免初始重叠）', xs.every(x => x >= 110 && x <= 250), xs.join(','))
check('答案 x 不是常量（有随机性）', new Set(xs).size > 1, `distinct=${new Set(xs).size}`)

console.log('--- 位置校验 ---')
const c1 = await newChallenge()
const a1 = await answerOf(c1.captchaId)
const okRes = await api('/auth/captcha/verify', { method: 'POST', body: JSON.stringify({ captchaId: c1.captchaId, x: a1 }) })
check('位置正确 → 通过并发放 ticket', okRes.json.code === 0 && typeof okRes.json.result?.ticket === 'string', okRes.json.message)

const replay = await api('/auth/captcha/verify', { method: 'POST', body: JSON.stringify({ captchaId: c1.captchaId, x: a1 }) })
check('同一挑战不能重放（一次性）', replay.json.code !== 0, replay.json.message)

const c2 = await newChallenge()
const a2 = await answerOf(c2.captchaId)
const near = await api('/auth/captcha/verify', { method: 'POST', body: JSON.stringify({ captchaId: c2.captchaId, x: a2 + 5 }) })
check('偏差 5px（容差内）通过', near.json.code === 0, near.json.message)

const c3 = await newChallenge()
const a3 = await answerOf(c3.captchaId)
const far = await api('/auth/captcha/verify', { method: 'POST', body: JSON.stringify({ captchaId: c3.captchaId, x: a3 + 6 }) })
check('偏差 6px（超容差）被拒绝', far.json.code !== 0, far.json.message)

const missId = await api('/auth/captcha/verify', { method: 'POST', body: JSON.stringify({ x: 100 }) })
check('缺 captchaId → 业务错误', missId.json.code !== 0, missId.json.message)

const badX = await api('/auth/captcha/verify', { method: 'POST', body: JSON.stringify({ captchaId: c2.captchaId, x: 'abc' }) })
check('x 非数字 → 业务错误', badX.json.code !== 0, badX.json.message)

const unknown = await api('/auth/captcha/verify', { method: 'POST', body: JSON.stringify({ captchaId: '00000000-0000-0000-0000-000000000000', x: 150 }) })
check('未知 captchaId → 过期提示', unknown.json.code !== 0, unknown.json.message)

console.log('--- ticket 一次性消费 ---')
const c4 = await newChallenge()
const a4 = await answerOf(c4.captchaId)
const pass1 = await api('/auth/captcha/verify', { method: 'POST', body: JSON.stringify({ captchaId: c4.captchaId, x: a4 }) })
const ticket = pass1.json.result?.ticket

const loginOk = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, captchaTicket: ticket }) })
check('持 ticket 登录成功', loginOk.json.code === 0 && !!loginOk.json.result?.accessToken, loginOk.json.message)

const loginReplay = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, captchaTicket: ticket }) })
check('同一 ticket 第二次登录被拒（已消费）', loginReplay.json.code !== 0, loginReplay.json.message)

const loginNoTicket = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }) })
check('不带 ticket 登录被拒', loginNoTicket.json.code !== 0, loginNoTicket.json.message)

const loginFakeTicket = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, captchaTicket: 'fake-ticket' }) })
check('伪造 ticket 登录被拒', loginFakeTicket.json.code !== 0, loginFakeTicket.json.message)

console.log(`\n${pass}/${pass + fail}`)
await redis.quit()
process.exit(fail === 0 ? 0 : 1)
