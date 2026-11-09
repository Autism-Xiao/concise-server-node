/**
 * 批量与导入导出冒烟：职级 / 岗位 / 字典 / 部门 / 角色 / 菜单 / 作业
 *
 * 覆盖的是「公共件落地后这些模块真的能用」，不是重新验业务规则：
 *  1. 导出：HTTP 200 + xlsx 类型 + 有实际字节
 *  2. 导入：生成的 xlsx 能被识别，新增生效，非法行只失败自己那一行
 *  3. 批量删除：成功条数正确、不存在的 id 会被明确报出来、业务保护规则仍然生效
 *  4. 字典导出为双工作表（字典类型 + 字典项）
 *
 * 运行前提：后端关闭验证码（滑块票据本地无法自动化）
 *   PORT=3461 CAPTCHA_ENABLED=false node dist/main.js
 *   BASE_URL=http://127.0.0.1:3461 node scripts/smoke-batch-io.mjs
 *
 * 全部测试数据以 bs_<时间戳> 命名，跑完自行清理；失败时也会尽力清理。
 */
import ExcelJS from 'exceljs'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3461'
const API = `${BASE}/api/v1`
const STAMP = Date.now().toString(36)

let passed = 0
const failures = []

/** Nest 的 POST 默认 201，写操作断言必须同时接受 200/201 */
const okStatus = status => status === 200 || status === 201

function check(name, ok, detail) {
  if (ok) {
    passed += 1
    console.log(`PASS  ${name}`)
    return
  }
  failures.push(name)
  console.log(`FAIL  ${name}${detail === undefined ? '' : `  → ${JSON.stringify(detail)}`}`)
}

async function login(username, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  const body = await res.json()
  if (!body?.result?.accessToken) {
    throw new Error(`登录失败: ${res.status} ${JSON.stringify(body).slice(0, 200)}`)
  }
  return body.result.accessToken
}

/** 普通 JSON 调用 */
async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, body: json, result: json?.result, text }
}

/** 下载型调用：只看状态/类型/字节数 */
async function download(path, token) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  const buf = Buffer.from(await res.arrayBuffer())
  return { status: res.status, type: res.headers.get('content-type') ?? '', size: buf.length, buffer: buf }
}

/** 上传 Excel（multipart，字段名 file） */
async function upload(path, token, filename, buffer) {
  const form = new FormData()
  form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename)
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, body: json, result: json?.result, text }
}

/** 生成一个单表 xlsx：第一行表头 */
async function buildSheet(headers, rows) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('导入')
  sheet.addRow(headers)
  rows.forEach(row => sheet.addRow(row))
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

async function sheetNames(buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  return workbook.worksheets.map(sheet => sheet.name)
}

/** 按关键词找出一条记录的 id（导入后用） */
async function findIdByKeyword(path, token, keyword, nameField) {
  const res = await api(`${path}?keyword=${encodeURIComponent(keyword)}&pageSize=100`, { token })
  const records = res.result?.records ?? []
  return records.find(item => item[nameField] === keyword)?.id
}

const created = { levels: [], posts: [], dicts: [], dictItems: [], depts: [], roles: [] }

async function main() {
  const token = await login('admin', 'admin123')

  /* ================= 1. 职级：导出 / 模板 / 导入 / 批量删除 ================= */
  {
    const exportRes = await download('/levels/export', token)
    check('职级导出 200 + xlsx + 有内容', exportRes.status === 200 && /spreadsheetml/.test(exportRes.type) && exportRes.size > 1000, {
      status: exportRes.status,
      type: exportRes.type,
      size: exportRes.size
    })

    const tpl = await download('/levels/import-template', token)
    check('职级导入模板可下载', tpl.status === 200 && tpl.size > 1000, { status: tpl.status, size: tpl.size })

    const nameA = `bs_职级A_${STAMP}`
    const nameB = `bs_职级B_${STAMP}`
    const bad = await buildSheet(
      ['职级名称', '等级数值', '状态', '备注'],
      [
        [nameA, '3', '正常', '冒烟'],
        [nameB, '4', '停用', '冒烟'],
        [`bs_职级坏行_${STAMP}`, 'abc', '正常', '等级数值非法']
      ]
    )
    const imported = await upload('/levels/import', token, 'levels.xlsx', bad)
    check('职级导入：2 条成功、1 条失败（行级结算）', okStatus(imported.status) && imported.result?.created === 2 && imported.result?.failed === 1, imported.result)
    check('职级导入：错误行带行号与原因', (imported.result?.errors ?? []).length === 1 && typeof imported.result.errors[0].row === 'number' && !!imported.result.errors[0].message, imported.result?.errors?.[0])

    const idA = await findIdByKeyword('/levels', token, nameA, 'levelName')
    if (idA) created.levels.push(idA)
    check('职级导入后可按名称查到', !!idA, { nameA, idA })

    const removed = await api('/levels/batch-delete', { method: 'POST', token, body: { ids: [idA, 'not-exist-id'].filter(Boolean) } })
    check('职级批量删除：deleted=1，不存在的 id 进 failed', okStatus(removed.status) && removed.result?.deleted === 1 && (removed.result?.failed ?? []).length === 1, removed.result)
    check('职级批量删除：失败原因可读', (removed.result?.failed ?? [])[0]?.reason === '记录不存在或已被删除', removed.result?.failed?.[0])

    // 清掉导入的另一条
    const idB = await findIdByKeyword('/levels', token, nameB, 'levelName')
    if (idB) await api('/levels/batch-delete', { method: 'POST', token, body: { ids: [idB] } })
    created.levels = []
  }

  /* ================= 2. 岗位：导出 / 批量删除 ================= */
  {
    const exportRes = await download('/posts/export', token)
    check('岗位导出 200 + xlsx + 有内容', exportRes.status === 200 && /spreadsheetml/.test(exportRes.type) && exportRes.size > 1000, {
      status: exportRes.status,
      size: exportRes.size
    })

    const code = `bs_post_${STAMP}`
    const made = await api('/posts', { method: 'POST', token, body: { postCode: code, postName: `冒烟岗位_${STAMP}`, postSort: 99, status: '1' } })
    check('岗位创建成功', made.status === 201 || made.status === 200, { status: made.status, body: made.body?.message })
    const id = made.result?.id
    if (id) created.posts.push(id)

    const removed = await api('/posts/batch-delete', { method: 'POST', token, body: { ids: [id] } })
    check('岗位批量删除：deleted=1、无失败项', okStatus(removed.status) && removed.result?.deleted === 1 && (removed.result?.failed ?? []).length === 0, removed.result)
    if (removed.result?.deleted === 1) created.posts = []
  }

  /* ================= 3. 字典：双工作表导出 / 字典项保护 / 批量删除 ================= */
  {
    const exportRes = await download('/dicts/export', token)
    const names = exportRes.status === 200 && exportRes.size > 1000 ? await sheetNames(exportRes.buffer) : []
    check('字典导出为双工作表（类型 + 字典项）', exportRes.status === 200 && names.length === 2, { status: exportRes.status, size: exportRes.size, names })
    check('字典导出工作表命名正确', names.includes('字典类型') && names.includes('字典项'), names)

    const dictCode = `bs_dict_${STAMP}`
    const madeDict = await api('/dicts', { method: 'POST', token, body: { dictName: `冒烟字典_${STAMP}`, dictCode, type: 1 } })
    const dictId = madeDict.result?.id
    if (dictId) created.dicts.push(dictId)
    check('字典类型创建成功', !!dictId, { status: madeDict.status, message: madeDict.body?.message })

    const madeItem = await api('/dict-items', { method: 'POST', token, body: { dictId, itemText: `冒烟项_${STAMP}`, itemValue: 'bs1', sortOrder: 1, status: 1 } })
    const itemId = madeItem.result?.id
    if (itemId) created.dictItems.push(itemId)
    check('字典项创建成功', !!itemId, { status: madeItem.status, message: madeItem.body?.message })

    const blocked = await api('/dicts/batch-delete', { method: 'POST', token, body: { ids: [dictId] } })
    check('字典类型下有字典项时批量删除被拒（进 failed 而非 500）', okStatus(blocked.status) && blocked.result?.deleted === 0 && (blocked.result?.failed ?? []).length === 1, blocked.result)
    check('字典删除失败原因可读', typeof (blocked.result?.failed ?? [])[0]?.reason === 'string' && blocked.result.failed[0].reason.length > 0, blocked.result?.failed?.[0])

    const itemRemoved = await api('/dict-items/batch-delete', { method: 'POST', token, body: { ids: [itemId] } })
    check('字典项批量删除成功', okStatus(itemRemoved.status) && itemRemoved.result?.deleted === 1, itemRemoved.result)
    if (itemRemoved.result?.deleted === 1) created.dictItems = []

    const dictRemoved = await api('/dicts/batch-delete', { method: 'POST', token, body: { ids: [dictId] } })
    check('清空字典项后字典类型可删', okStatus(dictRemoved.status) && dictRemoved.result?.deleted === 1, dictRemoved.result)
    if (dictRemoved.result?.deleted === 1) created.dicts = []
  }

  /* ================= 4. 部门：导出 / 子部门保护 / 批量删除 ================= */
  {
    const exportRes = await download('/depts/export', token)
    check('部门导出 200 + xlsx + 有内容', exportRes.status === 200 && /spreadsheetml/.test(exportRes.type) && exportRes.size > 1000, {
      status: exportRes.status,
      size: exportRes.size
    })

    const parent = await api('/depts', { method: 'POST', token, body: { departName: `bs_父部门_${STAMP}`, departOrder: 99, orgCategory: '2', status: '1' } })
    const parentId = parent.result?.id
    if (parentId) created.depts.push(parentId)
    const child = await api('/depts', { method: 'POST', token, body: { departName: `bs_子部门_${STAMP}`, parentId, departOrder: 1, orgCategory: '2', status: '1' } })
    const childId = child.result?.id
    if (childId) created.depts.push(childId)
    check('部门父子创建成功', !!parentId && !!childId, { parentId, childId, message: parent.body?.message })

    // 一次提交父子两个：子部门应先删成功，父部门因「还有子部门」失败
    const removed = await api('/depts/batch-delete', { method: 'POST', token, body: { ids: [parentId, childId] } })
    check(
      '部门批量删除：子部门成功、父部门被保护规则拒绝',
      okStatus(removed.status) && removed.result?.deleted === 1 && (removed.result?.failed ?? []).length === 1 && removed.result.failed[0].id === parentId,
      removed.result
    )

    // 子部门已删，父部门现在能删
    const retry = await api('/depts/batch-delete', { method: 'POST', token, body: { ids: [parentId] } })
    check('子部门删除后父部门可删', okStatus(retry.status) && retry.result?.deleted === 1, retry.result)
    if (retry.result?.deleted === 1) created.depts = []
  }

  /* ================= 5. 角色：导出 / 内置保护 / 批量删除 ================= */
  {
    const exportRes = await download('/roles/export', token)
    check('角色导出 200 + xlsx + 有内容', exportRes.status === 200 && /spreadsheetml/.test(exportRes.type) && exportRes.size > 1000, {
      status: exportRes.status,
      size: exportRes.size
    })

    const roleCode = `bs_role_${STAMP}`
    const made = await api('/roles', { method: 'POST', token, body: { roleName: `冒烟角色_${STAMP}`, roleCode, dataScope: 1, status: 1 } })
    const roleId = made.result?.id
    if (roleId) created.roles.push(roleId)
    check('角色创建成功', !!roleId, { status: made.status, message: made.body?.message })

    const roles = await api('/roles', { token })
    const roleRows = Array.isArray(roles.result) ? roles.result : (roles.result?.records ?? [])
    const builtinAdmin = roleRows.find(role => role.roleCode === 'admin')
    const removed = await api('/roles/batch-delete', { method: 'POST', token, body: { ids: [roleId, builtinAdmin?.id].filter(Boolean) } })
    check('角色批量删除：自建角色成功、内置 admin 被拒', okStatus(removed.status) && removed.result?.deleted === 1 && (removed.result?.failed ?? []).length === 1, removed.result)
    check('内置角色拒绝原因可读', typeof (removed.result?.failed ?? [])[0]?.reason === 'string', removed.result?.failed?.[0])
    if (removed.result?.deleted === 1) created.roles = []
  }

  /* ================= 6. 菜单导出 / 作业导出 / 在线批量强退 ================= */
  {
    const menuExport = await download('/menus/export', token)
    check('菜单导出 200 + xlsx + 有内容', menuExport.status === 200 && /spreadsheetml/.test(menuExport.type) && menuExport.size > 1000, {
      status: menuExport.status,
      size: menuExport.size
    })

    const jobExport = await download('/jobs/export', token)
    check('作业导出 200 + xlsx + 有内容', jobExport.status === 200 && /spreadsheetml/.test(jobExport.type) && jobExport.size > 500, {
      status: jobExport.status,
      size: jobExport.size
    })

    // 不存在的会话：接口应正常结算（kicked=0 + failed），而不是 500
    // 注意字段名是 ids（复用 BatchDeleteDto），不是 sessionIds
    const kick = await api('/online/batch-kick', { method: 'POST', token, body: { ids: ['bs-not-exist-session'] } })
    check('在线批量强退对无效会话正常结算', okStatus(kick.status) && (kick.result?.kicked === 0 || (kick.result?.failed ?? []).length >= 1), kick.result)
  }

  /* ================= 7. 公共件边界：空数组 400、超上限 400 ================= */
  {
    const empty = await api('/levels/batch-delete', { method: 'POST', token, body: { ids: [] } })
    check('批量删除空数组 → 400', empty.status === 400, { status: empty.status, message: empty.body?.message })

    const tooMany = await api('/levels/batch-delete', {
      method: 'POST',
      token,
      body: { ids: Array.from({ length: 201 }, (_, i) => `bs-${i}`) }
    })
    check('批量删除超 200 条 → 400', tooMany.status === 400, { status: tooMany.status, message: tooMany.body?.message })
  }
}

/** 兜底清理：即使断言失败也不留脏数据 */
async function cleanup(token) {
  const plans = [
    ['/dict-items/batch-delete', created.dictItems],
    ['/dicts/batch-delete', created.dicts],
    ['/posts/batch-delete', created.posts],
    ['/roles/batch-delete', created.roles],
    ['/levels/batch-delete', created.levels],
    ['/depts/batch-delete', created.depts]
  ]
  for (const [path, ids] of plans) {
    if (!ids.length) continue
    try {
      await api(path, { method: 'POST', token, body: { ids } })
    } catch {
      // 清理失败不影响冒烟结论
    }
  }
}

let tokenForCleanup = null
try {
  tokenForCleanup = await login('admin', 'admin123')
  await main()
} catch (error) {
  failures.push(`脚本异常：${error.message}`)
  console.log(`FAIL  脚本异常：${error.message}`)
  if (!tokenForCleanup) {
    try {
      tokenForCleanup = await login('admin', 'admin123')
    } catch {
      // 登录都失败时无法清理
    }
  }
} finally {
  if (tokenForCleanup) await cleanup(tokenForCleanup)
}

console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`)
if (failures.length) {
  console.log('失败清单：')
  failures.forEach(name => console.log(` - ${name}`))
  process.exit(1)
}
