/**
 * 列表「服务端筛选/排序/分页」冒烟
 *
 * 验证每个列表接口都真的认 page/pageSize/keyword/sortBy/sortOrder：
 * 返回体是统一分页结构、pageSize 生效、翻页换行、排序方向真的改变首条。
 *
 * 运行：PORT=3461 CAPTCHA_ENABLED=false 起实例后
 *   node scripts/smoke-server-list.mjs
 */
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3461/api/v1'

let passed = 0
let failed = 0

function check(name, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function login() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  })
  const body = await res.json()
  const token = body?.result?.accessToken
  if (!token) throw new Error(`登录失败: ${JSON.stringify(body).slice(0, 200)}`)
  return token
}

async function get(token, path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body, result: body?.result }
}

/** 统一断言：分页结构 + pageSize 生效 */
async function assertPaged(token, path, label, expectMax) {
  const { status, result } = await get(token, path)
  const ok =
    status === 200 &&
    result &&
    Array.isArray(result.records) &&
    typeof result.total === 'number' &&
    result.records.length <= expectMax &&
    (result.total < 0 || result.total >= result.records.length)
  check(`${label} 分页结构 + pageSize 生效`, ok, `status=${status} records=${result?.records?.length} total=${result?.total}`)
  return result
}

async function main() {
  const token = await login()
  console.log('\n== 列表接口：服务端分页 ==')

  const users = await assertPaged(token, '/users?page=1&pageSize=5', '用户列表', 5)
  await assertPaged(token, '/notices?page=1&pageSize=2', '公告列表', 2)
  await assertPaged(token, '/tasks?page=1&pageSize=2', '任务列表', 2)
  await assertPaged(token, '/dicts?page=1&pageSize=2', '字典列表', 2)
  await assertPaged(token, '/roles?page=1&pageSize=2', '角色列表', 2)
  await assertPaged(token, '/posts?page=1&pageSize=2', '岗位列表', 2)
  await assertPaged(token, '/levels?page=1&pageSize=2', '职级列表', 2)
  await assertPaged(token, '/tenants?page=1&pageSize=2', '租户列表', 2)
  await assertPaged(token, '/logs/oper?page=1&pageSize=2', '操作日志', 2)
  await assertPaged(token, '/logs/login?page=1&pageSize=2', '登录日志', 2)
  await assertPaged(token, '/logs/changes?page=1&pageSize=2', '变更日志', 2)
  await assertPaged(token, '/jobs?page=1&pageSize=2', '定时任务', 2)
  await assertPaged(token, '/online?page=1&pageSize=2', '在线用户', 2)
  await assertPaged(token, '/biz_orders?page=1&pageSize=2', '订单', 2)
  await assertPaged(token, '/customers?page=1&pageSize=2', '客户', 2)
  await assertPaged(token, '/suppliers?page=1&pageSize=2', '供应商', 2)

  console.log('\n== 关键字真的过滤 ==')
  const kw = await get(token, '/users?page=1&pageSize=10&keyword=admin')
  check('用户 keyword=admin 命中', kw.result?.records?.length >= 1 && kw.result.records.every(r => /admin/i.test(r.username)), `records=${kw.result?.records?.length}`)
  const kwNone = await get(token, '/users?page=1&pageSize=10&keyword=__no_such_user__')
  check('用户 keyword 无结果返回空集', kwNone.result?.records?.length === 0, `records=${kwNone.result?.records?.length}`)
  const dictKw = await get(token, '/dicts?page=1&pageSize=10&keyword=sys')
  check('字典 keyword=sys 命中', dictKw.result?.records?.length >= 1, `records=${dictKw.result?.records?.length}`)

  console.log('\n== 排序方向真的改变 ==')
  if ((users?.total ?? 0) > 1) {
    const asc = await get(token, '/users?page=1&pageSize=10&sortBy=username&sortOrder=asc')
    const desc = await get(token, '/users?page=1&pageSize=10&sortBy=username&sortOrder=desc')
    const firstAsc = asc.result?.records?.[0]?.username
    const firstDesc = desc.result?.records?.[0]?.username
    check('用户按账号升/降序首条不同', !!firstAsc && !!firstDesc && firstAsc !== firstDesc, `asc=${firstAsc} desc=${firstDesc}`)
  } else {
    check('用户排序（数据不足跳过）', true)
  }

  const rolesAsc = await get(token, '/roles?page=1&pageSize=10&sortBy=roleCode&sortOrder=asc')
  const rolesDesc = await get(token, '/roles?page=1&pageSize=10&sortBy=roleCode&sortOrder=desc')
  const rA = rolesAsc.result?.records?.map(r => r.roleCode)
  const rD = rolesDesc.result?.records?.map(r => r.roleCode)
  check(
    '角色按编码升序有序 / 降序为逆序',
    Array.isArray(rA) && Array.isArray(rD) && JSON.stringify(rA) === JSON.stringify([...rA].sort()) && JSON.stringify(rD) === JSON.stringify([...rD].sort().reverse()),
    `asc=${rA?.slice(0, 3)} desc=${rD?.slice(0, 3)}`
  )

  console.log('\n== 非法排序字段被静默忽略（不 500） ==')
  const badSort = await get(token, '/users?page=1&pageSize=2&sortBy=not_a_column&sortOrder=desc')
  check('sortBy 白名单外不报错', badSort.status === 200, `status=${badSort.status}`)
  const badOrder = await get(token, '/users?page=1&pageSize=2&sortBy=username&sortOrder=drop')
  check('sortOrder 非 asc/desc 被校验拦下', badOrder.status === 400, `status=${badOrder.status}`)

  console.log('\n== 翻页换行（不是把同一页重复返回） ==')
  // 用操作日志验证：它必然有多页，用户表在干净环境里可能只有一两行
  const opTotal = (await get(token, '/logs/oper?page=1&pageSize=1')).result?.total ?? 0
  if (opTotal > 1) {
    const p1 = await get(token, '/logs/oper?page=1&pageSize=5&sortBy=createTime&sortOrder=asc')
    const p2 = await get(token, '/logs/oper?page=2&pageSize=5&sortBy=createTime&sortOrder=asc')
    const ids1 = (p1.result?.records ?? []).map(r => r.id)
    const ids2 = (p2.result?.records ?? []).map(r => r.id)
    check('操作日志第 1/2 页无重复行', ids1.length > 0 && ids2.length > 0 && ids2.every(id => !ids1.includes(id)), `p1=${ids1.length} p2=${ids2.length}`)
  } else {
    check('翻页（数据不足跳过）', true)
  }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  if (failed > 0) process.exitCode = 1
}

main().catch(e => {
  console.error('冒烟异常：', e)
  process.exitCode = 1
})
