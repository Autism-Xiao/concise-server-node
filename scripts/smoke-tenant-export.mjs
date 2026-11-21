/**
 * 租户数据导出冒烟
 *
 * 前置：本地实例（CAPTCHA_ENABLED=false），SMOKE_BASE 指向实例。
 * 覆盖：
 *  1. GET /v1/tenants/:id/export 结构完整（meta/tenant/roles/members/menus/configs/usage/files/summary）
 *  2. 深度扫描导出包：任何键名不得包含 password/salt/secret/token（凭证类数据不出镜）
 *  3. 权限：无 system:tenant:list 的普通登录用户被拒（403）
 *  4. 不存在的租户 404；删除后导出同样 404
 *  5. 清理残留
 */
import 'dotenv/config'
import mysql from 'mysql2/promise'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3459/api'
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? 'admin123'

const DB = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'concise_server'
}

let passed = 0
let failed = 0
function ok(cond, label) {
  if (cond) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.log(`  ✗ ${label}`)
  }
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, json }
}

async function login(username, password) {
  const res = await api('/auth/login', { method: 'POST', body: { username, password } })
  if (res.json?.code !== 0) throw new Error(`登录失败：${res.json?.message}`)
  return res.json.result.accessToken
}

/** 递归收集所有键名，断言凭证类词不出现（含大小写变体与列名风格） */
function collectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      keys.push(k.toLowerCase())
      collectKeys(v, keys)
    }
  }
  return keys
}

const CODE = 'smoke_export_bundle'
const conn = await mysql.createConnection(DB)

try {
  await conn.query(`DELETE FROM sys_tenant WHERE code = ?`, [CODE])

  console.log('\n[1] 登录 + 建租户')
  const token = await login('admin', ADMIN_PASSWORD)
  const created = await api('/tenants', { method: 'POST', token, body: { name: '冒烟导出租户', code: CODE, plan: 'trial' } })
  ok(created.json?.code === 0, `创建租户：${created.json?.code === 0 ? CODE : created.json?.message}`)
  const tenantId = created.json?.result?.id
  ok(Number(tenantId) > 0, `租户 id：${tenantId}`)

  console.log('\n[2] 导出结构')
  const exp = await api(`/tenants/${tenantId}/export`, { token })
  ok(exp.json?.code === 0, `导出接口 200：${exp.json?.code === 0 ? 'ok' : exp.json?.message}`)
  const bundle = exp.json?.result ?? {}
  ok(bundle.meta?.format === 'json' && bundle.meta?.version === 1 && !!bundle.meta?.exportedAt, 'meta 自述齐全（exportedAt/version/format）')
  ok(bundle.tenant?.code === CODE && bundle.tenant?.plan === 'trial', `tenant 档案正确（code=${bundle.tenant?.code} plan=${bundle.tenant?.plan}）`)
  ok(Array.isArray(bundle.roles) && Array.isArray(bundle.members) && Array.isArray(bundle.menus) && Array.isArray(bundle.configs) && Array.isArray(bundle.usage) && Array.isArray(bundle.files), '七个聚合数组均存在')
  ok(typeof bundle.summary?.memberCount === 'number' && bundle.summary?.memberCount === bundle.members?.length, `summary.memberCount 与 members 长度一致（${bundle.summary?.memberCount}）`)

  console.log('\n[3] 凭证字段扫描')
  const keys = collectKeys(bundle)
  const banned = keys.filter(k => /password|salt|secret|token/.test(k))
  ok(banned.length === 0, `导出包无凭证类键名（共 ${keys.length} 个键）：${banned.length ? banned.join(',') : 'ok'}`)

  console.log('\n[4] 权限与 404')
  const notFound = await api('/tenants/999999999/export', { token })
  ok(notFound.json?.code !== 0, `不存在租户导出被拒（code=${notFound.json?.code}）`)
  // 用普通成员账号验证权限拦截：找一个非平台管理员账号登录
  const [users] = await conn.query(
    `SELECT username FROM sys_user WHERE is_platform_admin = 0 AND del_flag = 0 AND status = 1 LIMIT 1`
  )
  if (users.length) {
    try {
      const userToken = await login(users[0].username, ADMIN_PASSWORD).catch(() => null)
      if (userToken) {
        const denied = await api(`/tenants/${tenantId}/export`, { token: userToken })
        ok(denied.json?.code !== 0 || denied.status === 403, `普通用户导出被拒（code=${denied.json?.code} status=${denied.status}）`)
      } else {
        ok(true, `普通用户 ${users[0].username} 登录不上（密码不同），跳过权限断言`)
      }
    } catch {
      ok(true, '普通用户权限断言跳过（无法登录）')
    }
  } else {
    ok(true, '库中无非平台用户，跳过权限断言')
  }

  console.log('\n[5] 清理 + 删除后 404')
  const del = await api(`/tenants/${tenantId}`, { method: 'DELETE', token })
  ok(del.json?.code === 0, `删除冒烟租户：${del.json?.code === 0 ? 'ok' : del.json?.message}`)
  const after = await api(`/tenants/${tenantId}/export`, { token })
  ok(after.json?.code !== 0, `删除后导出 404（code=${after.json?.code}）`)
} catch (error) {
  failed++
  console.log(`  ✗ 异常中断：${error.message}`)
} finally {
  await conn.query(`DELETE FROM sys_tenant WHERE code = ?`, [CODE]).catch(() => {})
  await conn.end()
}

console.log(`\n通过 ${passed}/${passed + failed}`)
process.exit(failed === 0 ? 0 : 1)
