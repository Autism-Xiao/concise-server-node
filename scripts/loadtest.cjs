/**
 * 轻量压测脚本（无第三方依赖）：node scripts/loadtest.cjs
 * 用途：本地/预发环境做基线压测，暴露 N+1、缺索引、连接池瓶颈；不是专业压测替代品（正式压测用 k6/JMeter）。
 *
 * 用法：node scripts/loadtest.cjs <baseUrl> <accessToken> [concurrencyList]
 * 例： node scripts/loadtest.cjs http://localhost:3461 eyJhbG... 10,50,100
 */
const BASE = process.argv[2] || 'http://localhost:3461'
const TOKEN = process.argv[3] || ''
const LEVELS = (process.argv[4] || '10,50,100').split(',').map(Number)

/** 场景定义：name / 请求构造 / 是否带 token */
const SCENARIOS = [
  { name: 'GET /v1/auth/sso/config（轻·公开）', path: '/api/v1/auth/sso/config', auth: false },
  { name: 'GET /v1/dashboard/overview（重·聚合）', path: '/api/v1/dashboard/overview', auth: true },
  { name: 'GET /v1/users?page=1&size=20（列表）', path: '/api/v1/users?page=1&size=20', auth: true },
  { name: 'GET /v1/menus/tree（树构建）', path: '/api/v1/menus/tree', auth: true }
]

const sleep = ms => new Promise(r => setTimeout(r, ms))
const percent = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] }

async function runScenario(scenario, concurrency, durationMs) {
  const latencies = []
  let errors = 0, codes = {}
  const stopAt = Date.now() + durationMs
  const headers = { 'Content-Type': 'application/json' }
  if (scenario.auth && TOKEN) headers.Authorization = `Bearer ${TOKEN}`

  const worker = async () => {
    while (Date.now() < stopAt) {
      const t0 = performance.now()
      try {
        const res = await fetch(BASE + scenario.path, { headers, signal: AbortSignal.timeout(10_000) })
        codes[res.status] = (codes[res.status] || 0) + 1
        if (res.status >= 400) errors++
        await res.arrayBuffer().catch(() => {})
      } catch {
        errors++
        codes['ERR'] = (codes['ERR'] || 0) + 1
      }
      latencies.push(performance.now() - t0)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  const rps = latencies.length / (durationMs / 1000)
  return {
    concurrency,
    total: latencies.length,
    rps: rps.toFixed(0),
    avg: (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(0),
    p95: percent(latencies, 0.95).toFixed(0),
    p99: percent(latencies, 0.99).toFixed(0),
    errRate: ((errors / Math.max(latencies.length, 1)) * 100).toFixed(1) + '%',
    codes
  }
}

;(async () => {
  console.log(`目标: ${BASE}  鉴权: ${TOKEN ? '已带 token' : '无（仅公开接口）'}\n`)
  for (const scenario of SCENARIOS) {
    if (scenario.auth && !TOKEN) continue
    console.log(`▶ ${scenario.name}`)
    for (const c of LEVELS) {
      const r = await runScenario(scenario, c, 5000)
      console.log(`  并发${String(c).padStart(4)} | RPS ${String(r.rps).padStart(6)} | avg ${String(r.avg).padStart(5)}ms | p95 ${String(r.p95).padStart(6)}ms | p99 ${String(r.p99).padStart(6)}ms | 错误率 ${r.errRate} | 状态码 ${JSON.stringify(r.codes)}`)
      await sleep(1500) // 冷却，避免上一档余热干扰下一档
    }
    console.log('')
  }
})()
