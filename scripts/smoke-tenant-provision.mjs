/**
 * 租户初始化（默认角色模板）冒烟
 *
 * 覆盖：建租户自动落 admin/editor/viewer → 权限条数与菜单总量对得上 → 重复初始化幂等
 *      → 新增菜单后能补齐 → 租户管理员真的能拿到菜单树与按钮权限（端到端）
 *
 * 运行前提：
 *   1. 本机 MySQL（默认 127.0.0.1:3306 / root）可连，库 concise_server
 *   2. 有一个测试实例在跑：PORT=3461 CAPTCHA_ENABLED=false node dist/main.js
 *   3. 账号 admin / admin123 存在且是平台管理员
 *
 * 用法：node scripts/smoke-tenant-provision.mjs
 * 环境变量：SMOKE_BASE / SMOKE_DB_HOST / SMOKE_DB_USER / SMOKE_DB_PASSWORD
 */
import mysql from 'mysql2/promise'

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3461/api/v1'
const TAG = `prov${Date.now().toString(36)}`
const MENU_ID = `smoke_${TAG}`

let passed = 0
let failed = 0

function ok(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.log(`  ✗ ${name}${detail === undefined ? '' : ` —— ${JSON.stringify(detail)}`}`)
  }
}

async function api(path, { method = 'GET', token, tenantId, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (tenantId !== undefined) headers['X-Tenant-Id'] = String(tenantId)
  const response = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await response.json().catch(() => null)
  return { status: response.status, json }
}

const db = await mysql.createConnection({
  host: process.env.SMOKE_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.SMOKE_DB_PORT ?? 3306),
  user: process.env.SMOKE_DB_USER ?? 'root',
  password: process.env.SMOKE_DB_PASSWORD ?? '123456',
  database: process.env.SMOKE_DB_NAME ?? 'concise_server'
})

/** 角色 → 已授权菜单数（含 platform 级的，用于反向断言） */
async function countGrants(roleId) {
  const [rows] = await db.query('SELECT COUNT(*) AS total FROM sys_role_permission WHERE role_id = ?', [roleId])
  return Number(rows[0].total)
}

let tenantId = null
let testUserId = null

try {
  console.log(`\n[1] 平台管理员登录`)
  const login = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })
  ok('登录成功', login.json?.code === 0, login.json?.message)
  const token = login.json?.result?.accessToken
  if (!token) throw new Error('未拿到 accessToken，后续用例无法执行')

  const [menuRows] = await db.query(`SELECT COUNT(*) AS total FROM sys_permission WHERE del_flag = 0 AND status = '1' AND scope = 'tenant'`)
  const tenantMenuTotal = Number(menuRows[0].total)

  console.log(`\n[2] 新建租户时自动初始化角色（租户级菜单共 ${tenantMenuTotal} 个）`)
  const created = await api('/tenants', { method: 'POST', token, body: { name: `初始化测试租户${TAG}`, code: `smk_${TAG}` } })
  ok('创建租户成功', created.json?.code === 0, created.json?.message)
  tenantId = created.json?.result?.id
  ok('返回租户 ID', typeof tenantId === 'number', tenantId)
  if (!tenantId) throw new Error('租户未创建，后续用例无法执行')

  const rolesResponse = await api('/roles', { token, tenantId })
  // 列表接口统一返回分页结构（records/total/current/size/pages），角色少时 size = total
  const rolePayload = rolesResponse.json?.result
  const roles = Array.isArray(rolePayload) ? rolePayload : (rolePayload?.records ?? [])
  const byCode = new Map(roles.map(role => [role.roleCode, role]))
  ok('自动生成 admin 角色', byCode.has('admin'), roles.map(r => r.roleCode))
  ok('自动生成 editor 角色', byCode.has('editor'))
  ok('自动生成 viewer 角色', byCode.has('viewer'))
  ok('admin 是内置角色', Number(byCode.get('admin')?.isBuiltin) === 1)
  ok('editor / viewer 非内置', Number(byCode.get('editor')?.isBuiltin) === 0 && Number(byCode.get('viewer')?.isBuiltin) === 0)

  const adminRoleId = byCode.get('admin')?.id
  const editorRoleId = byCode.get('editor')?.id
  const viewerRoleId = byCode.get('viewer')?.id

  const adminGrants = await countGrants(adminRoleId)
  const editorGrants = await countGrants(editorRoleId)
  const viewerGrants = await countGrants(viewerRoleId)
  ok('admin 授权数 = 全部租户级菜单', adminGrants === tenantMenuTotal, { adminGrants, tenantMenuTotal })
  ok('viewer 授权数少于 editor', viewerGrants < editorGrants, { viewerGrants, editorGrants })
  ok('editor 授权数少于 admin', editorGrants < adminGrants, { editorGrants, adminGrants })
  ok('viewer 拿到了只读权限（>0）', viewerGrants > 0, viewerGrants)

  const [platformLeak] = await db.query(
    `SELECT COUNT(*) AS total FROM sys_role_permission rp
       INNER JOIN sys_permission p ON p.id = rp.permission_id
      WHERE rp.role_id = ? AND p.scope = 'platform'`,
    [adminRoleId]
  )
  ok('admin 角色没有混入平台级菜单', Number(platformLeak[0].total) === 0, platformLeak[0].total)

  const [viewerDelete] = await db.query(
    `SELECT COUNT(*) AS total FROM sys_role_permission rp
       INNER JOIN sys_permission p ON p.id = rp.permission_id
      WHERE rp.role_id = ? AND (p.perms LIKE '%:delete' OR p.perms LIKE '%:reset-password' OR p.perms LIKE '%:restore')`,
    [viewerRoleId]
  )
  ok('viewer 没有删除/重置密码类权限', Number(viewerDelete[0].total) === 0, viewerDelete[0].total)

  console.log('\n[3] 重复初始化幂等')
  const again = await api(`/tenants/${tenantId}/provision`, { method: 'POST', token })
  const againRoles = again.json?.result?.roles ?? []
  ok('重复调用成功', again.json?.code === 0, again.json?.message)
  ok('没有新建角色', againRoles.every(role => role.created === false))
  ok('没有新增授权', againRoles.every(role => role.added === 0), againRoles.map(r => [r.roleCode, r.added]))

  console.log('\n[4] 新增租户级菜单后补齐授权')
  await db.query(
    `INSERT INTO sys_permission (id, parent_id, name, url, menu_type, perms, sort_no, status, scope, del_flag, create_time)
     VALUES (?, NULL, '冒烟临时菜单', NULL, 2, 'system:smoke:demoop', 9999, '1', 'tenant', 0, NOW())`,
    [MENU_ID]
  )
  const resync = await api(`/tenants/${tenantId}/provision`, { method: 'POST', token })
  const resyncRoles = new Map((resync.json?.result?.roles ?? []).map(role => [role.roleCode, role]))
  ok('重新初始化成功', resync.json?.code === 0, resync.json?.message)
  ok('admin 补到新菜单', resyncRoles.get('admin')?.added === 1, resyncRoles.get('admin')?.added)
  ok('editor 补到新菜单', resyncRoles.get('editor')?.added === 1, resyncRoles.get('editor')?.added)
  ok('viewer 不拿写权限', resyncRoles.get('viewer')?.added === 0, resyncRoles.get('viewer')?.added)
  await db.query('DELETE FROM sys_permission WHERE id = ?', [MENU_ID])

  console.log('\n[5] 租户管理员端到端：菜单树与按钮权限')
  // 复制 admin 整行造临时账号：密码哈希与 admin 一致（admin123），但必须显式清掉平台管理员标记，
  // 否则这个账号会绕过全部租户校验，用例也就测不到「租户管理员」这条路径了
  const [adminRows] = await db.query("SELECT password, salt FROM sys_user WHERE username = 'admin' AND del_flag = 0 LIMIT 1")
  const source = adminRows[0]
  if (!source) throw new Error('未找到 admin 账号，无法构造租户管理员')
  testUserId = `smk${TAG}`.slice(0, 32)
  await db.query(
    `INSERT INTO sys_user (id, username, realname, password, salt, status, del_flag, is_platform_admin, create_time)
     VALUES (?, ?, '冒烟租户管理员', ?, ?, 1, 0, 0, NOW())`,
    [testUserId, `smk_${TAG}`, source.password, source.salt ?? null]
  )
  await db.query('INSERT INTO sys_user_role (user_id, role_id, tenant_id) VALUES (?, ?, ?)', [testUserId, adminRoleId, tenantId])
  await db.query('INSERT INTO sys_user_tenant (user_id, tenant_id, status, create_time) VALUES (?, ?, 0, NOW())', [testUserId, tenantId])

  const tenantLogin = await api('/auth/login', { method: 'POST', body: { username: `smk_${TAG}`, password: 'admin123' } })
  ok('租户管理员登录成功', tenantLogin.json?.code === 0, tenantLogin.json?.message)
  const perms = await api('/auth/permissions', { token: tenantLogin.json?.result?.accessToken, tenantId })
  const menuCount = countTree(perms.json?.result?.menus ?? [])
  ok('拿到侧边栏菜单（非空）', menuCount > 0, menuCount)
  ok('角色里有 admin', (perms.json?.result?.roles ?? []).includes('admin'), perms.json?.result?.roles)
  ok('按钮权限含 system:user:list', (perms.json?.result?.permissions ?? []).includes('system:user:list'))
  ok('不含平台级权限 system:tenant:list', !(perms.json?.result?.permissions ?? []).includes('system:tenant:list'))
  ok('菜单树里没有平台级页面 /system/tenant', !treeHasUrl(perms.json?.result?.menus ?? [], '/system/tenant'))
} catch (error) {
  failed += 1
  console.log(`\n✗ 执行中断：${error?.message ?? error}`)
} finally {
  // 清理：先断关系再删主体，避免租户删除被「还有用户」拦住
  if (tenantId) {
    if (testUserId) {
      await db.query('DELETE FROM sys_user_role WHERE user_id = ?', [testUserId]).catch(() => {})
      await db.query('DELETE FROM sys_user_tenant WHERE user_id = ?', [testUserId]).catch(() => {})
      await db.query('DELETE FROM sys_user WHERE id = ?', [testUserId]).catch(() => {})
    }
    await db.query('DELETE FROM sys_role_permission WHERE role_id IN (SELECT id FROM sys_role WHERE tenant_id = ?)', [tenantId]).catch(() => {})
    await db.query('DELETE FROM sys_role WHERE tenant_id = ?', [tenantId]).catch(() => {})
    await db.query('DELETE FROM sys_tenant WHERE id = ?', [tenantId]).catch(() => {})
  }
  await db.query('DELETE FROM sys_permission WHERE id = ?', [MENU_ID]).catch(() => {})
  await db.end()

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  process.exit(failed === 0 ? 0 : 1)
}

function countTree(nodes) {
  return (nodes ?? []).reduce((sum, node) => sum + 1 + countTree(node.children), 0)
}

function treeHasUrl(nodes, url) {
  return (nodes ?? []).some(node => node.url === url || treeHasUrl(node.children, url))
}
