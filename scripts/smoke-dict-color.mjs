/**
 * 字典颜色冒烟：color 字段的读写、白名单、清除语义、按编码透传
 *
 * 前置：需要一个免验证码的测试实例
 *   PORT=3461 CAPTCHA_ENABLED=false node scripts/serve.mjs
 * 运行：
 *   node scripts/smoke-dict-color.mjs
 *
 * 脚本会建一个 `smoke_dict_color_<时间戳>` 的临时字典，跑完删干净（含软删行）。
 * 覆盖的坑：
 * - color 传空串必须是「清除」，不能变成空字符串存库（前端「不套色」按钮就传空串）
 * - 非法色必须 400，否则任意字符串会顺着白名单缺口流到前端 className
 * - 列表接口要带 color，否则管理页回显不出来
 */
import mysql from 'mysql2/promise'

import { readXlsxTable } from '../dist/utils/xlsx.util.js'

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

async function login(username, password) {
  const res = await api('/auth/login', { method: 'POST', body: { username, password } })
  return res.data?.accessToken ?? res.data?.token ?? null
}

const token = await login('admin', 'admin123')
check('登录 admin', !!token)
if (!token) {
  await conn.end()
  process.exit(1)
}

const stamp = Date.now()
const dictCode = `smoke_dict_color_${stamp}`
let dictId = null
let itemId = null

try {
  // ---- 1. 存量优先级字典：迁移补的色要能被按编码读到 ----
  const priority = await api('/dict-items/code/sys_notice_priority', { token })
  check('按编码取公告优先级 200', priority.status === 200)
  const items = priority.data?.items ?? []
  check('公告优先级返回 3 项', items.length === 3, `实际 ${items.length}`)
  check('H → danger', items.find(i => i.itemValue === 'H')?.color === 'danger')
  check('M → warning', items.find(i => i.itemValue === 'M')?.color === 'warning')
  check('L → neutral', items.find(i => i.itemValue === 'L')?.color === 'neutral')

  // ---- 2. 建临时字典 ----
  const dict = await api('/dicts', {
    method: 'POST',
    token,
    body: { dictCode, dictName: '颜色冒烟字典', type: 0, description: 'smoke' }
  })
  check('建字典 200/201', dict.status === 200 || dict.status === 201, `status=${dict.status}`)
  dictId = dict.data?.id ?? null
  check('拿到字典 id', !!dictId)

  // ---- 3. 带颜色建项 ----
  const created = await api('/dict-items', {
    method: 'POST',
    token,
    body: { dictId, itemText: '已通过', itemValue: 'pass', sortOrder: 1, status: 1, color: 'success' }
  })
  check('建带色字典项成功', created.status === 200 || created.status === 201, `status=${created.status} ${JSON.stringify(created.body?.message ?? '')}`)
  itemId = created.data?.id ?? null
  check('返回 color=success', created.data?.color === 'success', `实际 ${created.data?.color}`)

  // ---- 4. 列表接口要带 color（管理页回显靠它） ----
  const list = await api(`/dict-items?dictId=${dictId}&page=1&pageSize=10`, { token })
  const listRow = (list.data?.records ?? []).find(i => i.id === itemId)
  check('列表带出 color', listRow?.color === 'success', `实际 ${listRow?.color}`)

  // ---- 5. 按编码透传（业务页 DictBadge 的数据源） ----
  const byCode = await api(`/dict-items/code/${dictCode}`, { token })
  check('按编码取到 color=success', (byCode.data?.items ?? [])[0]?.color === 'success')

  // ---- 6. 改色 ----
  const changed = await api(`/dict-items/${itemId}`, { method: 'PUT', token, body: { color: 'warning' } })
  check('改色为 warning', changed.data?.color === 'warning', `实际 ${changed.data?.color}`)

  // ---- 7. 空串 = 清除，不是存空字符串 ----
  const cleared = await api(`/dict-items/${itemId}`, { method: 'PUT', token, body: { color: '' } })
  check('空串清除为 null', cleared.data?.color === null || cleared.data?.color === undefined, `实际 ${JSON.stringify(cleared.data?.color)}`)

  // ---- 8. 非法色必须被白名单挡住 ----
  const bad = await api(`/dict-items/${itemId}`, { method: 'PUT', token, body: { color: 'bg-red-500' } })
  check('非法色被拒（非 2xx）', bad.status >= 400, `status=${bad.status}`)
  const badCreate = await api('/dict-items', {
    method: 'POST',
    token,
    body: { dictId, itemText: '非法色', itemValue: 'bad', sortOrder: 9, status: 1, color: 'red' }
  })
  check('非法色建项被拒（非 2xx）', badCreate.status >= 400, `status=${badCreate.status}`)

  // ---- 9. 导出/模板仍可用（加列不能把 xlsx 构建搞挂） ----
  for (const path of ['/dicts/import-template', '/dicts/export']) {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } })
    const buf = Buffer.from(await res.arrayBuffer())
    check(`${path} 返回 xlsx`, res.ok && buf.length > 2000 && buf.subarray(0, 2).toString() === 'PK', `status=${res.status} size=${buf.length}`)
  }

  // ---- 10. 导出 → 再导入闭环：颜色列必须对齐，行数组不能比表头短 ----
  const exportRes = await fetch(`${BASE}/dicts/export`, { headers: { Authorization: `Bearer ${token}` } })
  const exported = Buffer.from(await exportRes.arrayBuffer())
  const itemTable = await readXlsxTable(exported, { headerKeys: ['字典编码', '编码', 'dictcode'], sheetIndex: 1 })
  const header = itemTable.rows[0] ?? []
  const colorIndex = header.indexOf('颜色')
  check('导出「字典项」表含「颜色」列', colorIndex >= 0, `表头=${JSON.stringify(header)}`)
  const hRow = itemTable.rows.find(row => row[0] === 'sys_notice_priority' && row[2] === 'H')
  check('导出的 H 行颜色列 = danger', hRow?.[colorIndex] === 'danger', `实际 ${JSON.stringify(hRow?.[colorIndex])}`)

  const form = new FormData()
  form.append('file', new Blob([exported]), 'dicts.xlsx')
  const importRes = await fetch(`${BASE}/dicts/import`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  const importJson = await importRes.json().catch(() => ({}))
  const imported = importJson.result ?? importJson
  check('导出文件可原样导回，无失败行', importRes.ok && imported.failed === 0, `status=${importRes.status} failed=${imported.failed} ${JSON.stringify(imported.errors?.slice?.(0, 2) ?? '')}`)
} finally {
  // ---- 清理：项硬删、字典软删行物理删除 ----
  if (itemId) await api(`/dict-items/${itemId}`, { method: 'DELETE', token })
  if (dictId) await conn.query('DELETE FROM sys_dict_item WHERE dict_id = ?', [dictId])
  if (dictId) await conn.query('DELETE FROM sys_dict WHERE id = ?', [dictId])
  await conn.end()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
