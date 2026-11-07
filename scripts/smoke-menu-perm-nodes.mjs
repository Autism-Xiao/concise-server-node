/**
 * 菜单「权限节点」冒烟：全量替换（新增/保留/移除）/ 按钮下禁挂 / internalOrExternal 读写 / 未登录
 *
 * 前置：需要一个免验证码的测试实例
 *   PORT=3461 CAPTCHA_ENABLED=false node dist/main.js
 * 运行：
 *   node scripts/smoke-menu-perm-nodes.mjs
 *
 * 自建临时菜单跑完即删（软删），不留垃圾数据。
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

/** 查某菜单下未删除的按钮 perms 集合（直查库，绕开接口缓存时序） */
async function buttonPerms(parentId) {
  const [rows] = await conn.query("SELECT perms FROM sys_permission WHERE parent_id = ? AND menu_type = 2 AND del_flag = 0", [parentId])
  return new Set(rows.map(r => r.perms))
}

let tempIds = []
try {
  const { token } = await login('admin')

  // ---------- 1. 建临时父菜单 ----------
  const created = await api('/menus', {
    method: 'POST',
    token,
    body: { name: 'smoke_perm_node_菜单', menuType: 1, url: '/smoke/perm-node', sortNo: 999, internalOrExternal: 0 }
  })
  const menu = created.data
  check('创建临时菜单（带 internalOrExternal=0）', created.status === 201 && !!menu?.id, JSON.stringify(created.body).slice(0, 160))
  tempIds.push(menu.id)
  check('读回 internalOrExternal === 0', menu?.internalOrExternal === 0, `实际 ${menu?.internalOrExternal}`)

  // ---------- 2. 全量替换：首次赋予 2 个节点 ----------
  const P = '/smoke/perm-node'
  const r1 = await api(`/menus/${menu.id}/perm-nodes`, {
    method: 'PUT',
    token,
    body: { nodes: [{ name: '查询', perms: `${P}:list` }, { name: '添加', perms: `${P}:add` }] }
  })
  check('首次赋予 2 个节点 → added=2', r1.status === 200 && r1.data?.added?.length === 2, JSON.stringify(r1.body).slice(0, 160))
  check('库里能查到 2 个按钮', (await buttonPerms(menu.id)).size === 2)

  // ---------- 3. 交集保留 + 新增 1 个 ----------
  const r2 = await api(`/menus/${menu.id}/perm-nodes`, {
    method: 'PUT',
    token,
    body: { nodes: [{ name: '查询（改名）', perms: `${P}:list` }, { name: '添加', perms: `${P}:add` }, { name: '删除', perms: `${P}:delete` }] }
  })
  check('二次提交 → added=1 kept=2 removed=0', r2.data?.added?.length === 1 && r2.data?.kept?.length === 2 && r2.data?.removed?.length === 0, JSON.stringify(r2.data))
  const after2 = await buttonPerms(menu.id)
  check('交集 perms 保留', after2.has(`${P}:list`) && after2.has(`${P}:add`) && after2.has(`${P}:delete`))
  const [nameRow] = await conn.query('SELECT name FROM sys_permission WHERE parent_id = ? AND perms = ?', [menu.id, `${P}:list`])
  check('保留节点的名称随提交更新', nameRow[0]?.name === '查询（改名）', `实际 ${nameRow[0]?.name}`)

  // ---------- 4. 移除（全量替换语义：未列出的被软删） ----------
  const r3 = await api(`/menus/${menu.id}/perm-nodes`, {
    method: 'PUT',
    token,
    body: { nodes: [{ name: '查询（改名）', perms: `${P}:list` }] }
  })
  check('三次提交 → removed=2 kept=1', r3.data?.removed?.length === 2 && r3.data?.kept?.length === 1, JSON.stringify(r3.data))
  const after3 = await buttonPerms(menu.id)
  check('移除后库里只剩 1 个按钮', after3.size === 1 && after3.has(`${P}:list`))
  const [softRow] = await conn.query('SELECT COUNT(*) AS c FROM sys_permission WHERE parent_id = ? AND perms = ? AND del_flag = 1', [menu.id, `${P}:add`])
  check('被移除按钮是软删（del_flag=1）', softRow[0].c === 1)

  // ---------- 5. 防御：按钮下禁挂 / 空列表清空 / 未登录 401 ----------
  const [btnRows] = await conn.query('SELECT id FROM sys_permission WHERE parent_id = ? AND perms = ?', [menu.id, `${P}:list`])
  const r4 = await api(`/menus/${btnRows[0].id}/perm-nodes`, { method: 'PUT', token, body: { nodes: [{ name: 'x', perms: 'x:y' }] } })
  check('按钮下不能再挂按钮（400）', r4.status === 200 && r4.body?.code !== 0, JSON.stringify(r4.body).slice(0, 120))

  const r5 = await api(`/menus/${menu.id}/perm-nodes`, { method: 'PUT', token, body: { nodes: [] } })
  check('空列表清空全部按钮', r5.data?.removed?.length === 1 && (await buttonPerms(menu.id)).size === 0)

  const r6 = await api(`/menus/${menu.id}/perm-nodes`, { method: 'PUT', body: { nodes: [] } })
  check('未登录 401', r6.status === 401, `实际 ${r6.status}`)

  const r7 = await api('/menus', { method: 'POST', token, body: { name: 'x', menuType: 1, internalOrExternal: 2 } })
  check('internalOrExternal 非法值被拒（400）', r7.status === 400, `实际 ${r7.status}`)
} catch (e) {
  fail++
  console.error('FATAL', e)
} finally {
  // ---------- 清理：软删临时菜单与按钮 ----------
  if (tempIds.length) {
    await conn.query('UPDATE sys_permission SET del_flag = 1 WHERE id IN (?) OR parent_id IN (?)', [tempIds, tempIds])
    console.log(`\n已清理临时菜单 ${tempIds.join(', ')}`)
  }
  await conn.end()
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}
