/**
 * 部门管理冒烟：手编 orgCode 查重 / 同父级排序不冲码 / 状态与部门类型读写 / 用户表单下拉数据
 *
 * 前置：PORT=3461 CAPTCHA_ENABLED=false node dist/main.js
 * 运行：node scripts/smoke-dept-status.mjs（临时部门自动软删清理）
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
  return { token: res.data.accessToken }
}

let tempIds = []
try {
  const { token } = await login('admin')

  // ---------- 1. 手编编码创建 + 重复 400 ----------
  const c1 = await api('/depts', { method: 'POST', token, body: { departName: 'smoke部门A', orgCode: 'SMK_A', orgCategory: '2', departOrder: 99, status: '1' } })
  const deptA = c1.data
  check('手编编码创建（SMK_A）', c1.status === 201 && deptA?.orgCode === 'SMK_A', JSON.stringify(c1.body).slice(0, 160))
  tempIds.push(deptA.id)

  const c2 = await api('/depts', { method: 'POST', token, body: { departName: 'smoke部门B', orgCode: 'SMK_A' } })
  check('创建撞手编编码 → 400', c2.status === 400, `实际 ${c2.status} ${JSON.stringify(c2.body).slice(0, 120)}`)
  if (c2.data?.id) tempIds.push(c2.data.id)

  // ---------- 2. 改码查重（排除自身）+ 撞别人 400 ----------
  const u0 = await api(`/depts/${deptA.id}`, { method: 'PUT', token, body: { departName: 'smoke部门A', orgCode: 'SMK_A' } })
  check('改码提交自身原编码 → 不误判', u0.status === 200, JSON.stringify(u0.body).slice(0, 120))

  const c3 = await api('/depts', { method: 'POST', token, body: { departName: 'smoke部门B', orgCode: 'SMK_B', orgCategory: '4', status: '0' } })
  const deptB = c3.data
  tempIds.push(deptB.id)
  const u1 = await api(`/depts/${deptA.id}`, { method: 'PUT', token, body: { departName: 'smoke部门A', orgCode: 'SMK_B' } })
  check('改码撞别人编码 → 400', u1.status === 400, `实际 ${u1.status}`)

  // ---------- 3. 同父级排序不冲码 / 换父自动重算 ----------
  const u2 = await api(`/depts/${deptA.id}`, { method: 'PUT', token, body: { departName: 'smoke部门A', parentId: null, departOrder: 5 } })
  check('同父级拖拽排序后编码保持 SMK_A', u2.data?.orgCode === 'SMK_A', `实际 ${u2.data?.orgCode}`)

  const u3 = await api(`/depts/${deptB.id}`, { method: 'PUT', token, body: { departName: 'smoke部门B', parentId: deptA.id } })
  check('换父级后编码自动重算（不再保留手编 SMK_B 前缀场景按后端规则生成）', u3.status === 200 && !!u3.data?.orgCode && u3.data.orgCode !== 'SMK_B', `实际 ${u3.data?.orgCode}`)

  // ---------- 4. 状态 / 部门类型读写 ----------
  const u4 = await api(`/depts/${deptB.id}`, { method: 'PUT', token, body: { departName: 'smoke部门B', status: '1', orgCategory: '4' } })
  check('状态与部门类型更新生效', u4.data?.status === '1' && u4.data?.orgCategory === '4', JSON.stringify(u4.data).slice(0, 140))

  const list = await api('/depts', { token })
  const rowB = (list.data?.records ?? []).find(d => d.id === deptB.id)
  check('列表返回 status/orgCategory/createTime', !!rowB && rowB.status === '1' && rowB.orgCategory === '4' && !!rowB.createTime, JSON.stringify(rowB ?? {}).slice(0, 140))

  // ---------- 5. 未登录 401 ----------
  const r5 = await api('/depts', { method: 'POST', body: { departName: 'x' } })
  check('未登录 401', r5.status === 401, `实际 ${r5.status}`)
} catch (e) {
  fail++
  console.error('FATAL', e)
} finally {
  if (tempIds.length) {
    await conn.query("UPDATE sys_depart SET del_flag = '1' WHERE id IN (?)", [tempIds])
    console.log(`\n已清理临时部门 ${tempIds.length} 个`)
  }
  await conn.end()
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}
