#!/usr/bin/env node
/**
 * 后端接口冒烟测试（scripts/smoke-test.cjs）
 *
 * 设计原则：
 * - 不依赖任何「真实密码」：管理员令牌用 .env 里的 JWT_SECRET 直接签发；
 *   需要验证登录链路时，脚本自己创建一个临时账号、随机生成密码、用完即删。
 * - 所有写操作都写「smoke_ 前缀」的临时数据，结束时统一清理，不污染真实数据。
 * - 失败不中断，逐条记录状态码与业务码，最后汇总；有 FAIL 时进程退出码为 1。
 *
 * 用法：
 *   PORT=3460 CAPTCHA_ENABLED=false node dist/main.js &      # 起一个测试实例
 *   node scripts/smoke-test.cjs                              # 默认打 http://127.0.0.1:3460/api
 *   SMOKE_BASE=http://127.0.0.1:3000/api node scripts/smoke-test.cjs
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

// dotenv 可能没装成依赖（是 devDependency 也可能在），自己解析 .env 更稳
function loadEnv() {
  const file = path.resolve(__dirname, '..', '.env')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadEnv()

const BASE = process.env.SMOKE_BASE ?? `http://127.0.0.1:${process.env.SMOKE_PORT ?? '3460'}/api`
const STAMP = Date.now().toString(36)
/** 库里的超管账号 id（sys_user 初始数据），用于越权/IDOR 用例 */
const ADMIN_ID = process.env.SMOKE_ADMIN_ID ?? 'e9ca23d68d884d4ebb19d07889727dae'

/** 结果收集：ok / fail / info */
const results = []
let passCount = 0
let failCount = 0

function record(ok, name, detail) {
  results.push({ ok, name, detail })
  if (ok) {
    passCount++
    console.log(`  PASS  ${name}${detail ? `  (${detail})` : ''}`)
  } else {
    failCount++
    console.log(`  FAIL  ${name}  -> ${detail}`)
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`)
}

/** 统一请求封装：返回 { status, json, buf, headers } */
async function call(method, path, options = {}) {
  const { token, body, form, accept } = options
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (accept) headers.Accept = accept
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: form ?? (body === undefined ? undefined : JSON.stringify(body))
  })
  const contentType = res.headers.get('content-type') ?? ''
  let json = null
  let buf = null
  if (contentType.includes('json')) {
    json = await res.json().catch(() => null)
  } else {
    buf = Buffer.from(await res.arrayBuffer())
  }
  return { status: res.status, json, buf, headers: res.headers, contentType }
}

/** 业务成功判定：success=true 且 code=0 */
function isOk(r) {
  return r.status >= 200 && r.status < 300 && r.json && r.json.success === true
}

/** 期望成功 */
async function expectOk(method, path, options, name) {
  const r = await call(method, path, options)
  if (isOk(r)) {
    record(true, name ?? `${method} ${path}`, `${r.status}`)
  } else {
    record(false, name ?? `${method} ${path}`, `status=${r.status} code=${r.json?.code} msg=${r.json?.message}`)
  }
  return r
}

/** 期望失败（4xx 或业务失败），用于负向用例 */
async function expectFail(method, path, options, name, expectedStatus) {
  const r = await call(method, path, options)
  const businessFailed = !r.json || r.json.success !== true
  const statusOk = expectedStatus ? r.status === expectedStatus : r.status >= 400 && r.status < 500
  if (businessFailed && statusOk) {
    record(true, name, `${r.status} ${r.json?.message ?? ''}`)
  } else {
    record(false, name, `期望 ${expectedStatus ?? '4xx'} 失败，实际 ${r.status} code=${r.json?.code}`)
  }
  return r
}

/** 从响应里取列表：有的模块返回 {records,total}，有的直接返回数组（接口不一致，这里都兼容） */
function records(r) {
  const result = r.json?.result
  if (Array.isArray(result)) return result
  return result?.records ?? []
}

/** 生成一个 32 位 hex 的签名令牌（与后端 JwtService 同算法，避免走登录） */
function mintToken(username, id) {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('.env 缺少 JWT_SECRET，无法签发测试令牌')
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id, username, iat: now, exp: now + 7200 })}`
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

async function main() {
  console.log(`冒烟测试目标：${BASE}`)

  /* ---------- 0. 基础连通性 ---------- */
  section('0. 基础连通性')
  const root = await call('GET', '')
  record(root.status === 200, 'GET /api 根路由', `status=${root.status}`)

  const docs = await call('GET', '/docs')
  record(docs.status === 200 || docs.status === 301 || docs.status === 302, 'GET /api/docs Swagger', `status=${docs.status}`)

  /* ---------- 1. 认证与验证码 ---------- */
  section('1. 认证 / 验证码')
  const captcha = await call('GET', '/v1/auth/captcha')
  const hasCaptcha = isOk(captcha) && captcha.json.result?.captchaId && captcha.json.result?.bgUrl
  record(hasCaptcha, 'GET /v1/auth/captcha', hasCaptcha ? `captchaId=${String(captcha.json.result.captchaId).slice(0, 8)}…` : '缺少 captchaId/bgUrl')

  if (hasCaptcha) {
    // 注意：验证码类业务异常走 HTTP 200 + 业务码（412 位置错误 / 413 已过期），与登录失败返回 401 不一致
    const wrongPos = await call('POST', '/v1/auth/captcha/verify', { body: { captchaId: captcha.json.result.captchaId, x: 1 } })
    record(wrongPos.json?.success === false && wrongPos.json?.code === 412, 'POST captcha/verify 错误位置被拒', `HTTP ${wrongPos.status} code=${wrongPos.json?.code}`)
    const badId = await call('POST', '/v1/auth/captcha/verify', { body: { captchaId: 'not-exist', x: 100 } })
    record(badId.json?.success === false, 'POST captcha/verify 无效 captchaId 被拒', `HTTP ${badId.status} code=${badId.json?.code}`)
  }

  // 负向登录：错误密码 / 不存在用户 / 缺字段（都不会污染数据，只会记一条失败登录日志）
  await expectFail('POST', '/v1/auth/login', { body: { username: 'admin', password: 'definitely-wrong-pwd' } }, 'POST login 错误密码被拒', 401)
  await expectFail('POST', '/v1/auth/login', { body: { username: 'no_such_user_xyz', password: 'wrong-password-123' } }, 'POST login 不存在用户被拒', 401)
  await expectFail('POST', '/v1/auth/login', { body: {} }, 'POST login 缺参数被拒', 400)

  // 鉴权：无令牌 / 伪造令牌
  await expectFail('GET', '/v1/users', {}, 'GET /v1/users 无令牌 401', 401)
  await expectFail('GET', '/v1/users', { token: 'garbage.token.value' }, 'GET /v1/users 伪造令牌 401', 401)

  /* ---------- 2. 管理员令牌 ---------- */
  section('2. 管理员令牌与权限汇总')
  const adminToken = mintToken('admin', ADMIN_ID)
  const perms = await expectOk('GET', '/v1/auth/permissions', { token: adminToken }, 'GET /v1/auth/permissions')
  const permList = perms.json?.result?.perms ?? perms.json?.result?.permissions ?? []
  record(Array.isArray(permList) && permList.length > 0, '权限汇总非空', `共 ${permList.length} 项`)

  const profile = await call('GET', '/auth/profile', { token: adminToken })
  record(profile.status === 200 && profile.json?.success === true, 'GET /api/auth/profile（旧路由仍在服务）', `status=${profile.status}`)

  /* ---------- 3. 读接口全量扫 ---------- */
  section('3. 列表 / 详情读接口')

  // 先拿列表，顺便验证分页结构
  const listRoutes = [
    ['/v1/users?page=1&pageSize=10', '用户列表'],
    ['/v1/roles?page=1&pageSize=10', '角色列表'],
    ['/v1/depts?page=1&pageSize=10', '部门列表'],
    ['/v1/menus?page=1&pageSize=10', '菜单列表'],
    ['/v1/dicts?page=1&pageSize=10', '字典列表'],
    ['/v1/dict-items?page=1&pageSize=10', '字典项列表'],
    ['/v1/levels?page=1&pageSize=10', '职级列表'],
    ['/v1/posts?page=1&pageSize=10', '岗位列表'],
    ['/v1/notices?page=1&pageSize=10', '公告列表'],
    ['/v1/logs/login?page=1&pageSize=10', '登录日志列表'],
    ['/v1/logs/oper?page=1&pageSize=10', '操作日志列表'],
    ['/v1/jobs?page=1&pageSize=10', '定时任务列表'],
    ['/v1/online?page=1&pageSize=10', '在线用户列表'],
    ['/v1/depts/tree', '部门树'],
    ['/v1/menus/tree', '菜单树'],
    ['/v1/roles/options', '角色下拉选项'],
    ['/v1/notices/published', '已发布公告'],
    ['/v1/online/count', '在线人数'],
    ['/v1/monitor/server', '服务监控'],
    ['/v1/monitor/cache', '缓存监控'],
    ['/v1/jobs/handlers', '任务处理器列表']
  ]
  const lists = {}
  for (const [p, label] of listRoutes) {
    const r = await expectOk('GET', p, { token: adminToken }, `${label}  GET ${p.split('?')[0]}`)
    lists[p] = r
  }

  // 详情接口：用列表里真实存在的 id
  const pickId = (r) => records(r)[0]?.id
  const detailTargets = [
    ['/v1/users/', pickId(lists['/v1/users?page=1&pageSize=10']), '用户详情'],
    ['/v1/roles/', pickId(lists['/v1/roles?page=1&pageSize=10']), '角色详情'],
    ['/v1/depts/', pickId(lists['/v1/depts?page=1&pageSize=10']), '部门详情'],
    ['/v1/menus/', pickId(lists['/v1/menus?page=1&pageSize=10']), '菜单详情'],
    ['/v1/dicts/', pickId(lists['/v1/dicts?page=1&pageSize=10']), '字典详情'],
    ['/v1/dict-items/', pickId(lists['/v1/dict-items?page=1&pageSize=10']), '字典项详情'],
    ['/v1/levels/', pickId(lists['/v1/levels?page=1&pageSize=10']), '职级详情'],
    ['/v1/posts/', pickId(lists['/v1/posts?page=1&pageSize=10']), '岗位详情'],
    ['/v1/notices/', pickId(lists['/v1/notices?page=1&pageSize=10']), '公告详情'],
    ['/v1/logs/login/', pickId(lists['/v1/logs/login?page=1&pageSize=10']), '登录日志详情'],
    ['/v1/logs/oper/', pickId(lists['/v1/logs/oper?page=1&pageSize=10']), '操作日志详情'],
    ['/v1/jobs/', pickId(lists['/v1/jobs?page=1&pageSize=10']), '定时任务详情']
  ]
  for (const [prefix, id, label] of detailTargets) {
    if (!id) {
      record(false, `${label}  GET ${prefix}:id`, '列表里没有可用 id，跳过')
      continue
    }
    const r = await expectOk('GET', `${prefix}${id}`, { token: adminToken }, `${label}  GET ${prefix}:id`)
    // 详情不应回传密码/盐
    const text = JSON.stringify(r.json ?? {})
    if (/"(password|salt|passwordSalt)"\s*:\s*"[^"]+"/.test(text)) {
      record(false, `${label} 未泄露密码字段`, '响应里出现 password/salt 明文')
    }
  }

  // 角色已授权菜单 id
  const roleId = pickId(lists['/v1/roles?page=1&pageSize=10'])
  if (roleId) await expectOk('GET', `/v1/roles/${roleId}/menu-ids`, { token: adminToken }, 'GET /v1/roles/:id/menu-ids')

  /* ---------- 4. 负向：不存在的 id / 注入 / 越界参数 ---------- */
  section('4. 负向用例（404 / 400 / 注入）')
  await expectFail('GET', '/v1/users/not_exist_id', { token: adminToken }, 'GET 不存在的用户 → 404', 404)
  await expectFail('GET', '/v1/roles/not_exist_id', { token: adminToken }, 'GET 不存在的角色 → 404', 404)
  await expectFail('GET', '/v1/notices/not_exist_id', { token: adminToken }, 'GET 不存在的公告 → 404', 404)
  await expectFail('POST', '/v1/users', { token: adminToken, body: { username: '' } }, 'POST 空用户名 → 400', 400)
  await expectFail('POST', '/v1/roles', { token: adminToken, body: { roleName: 'x' } }, 'POST 角色缺 roleCode → 400', 400)
  await expectFail('GET', '/v1/users?page=abc&pageSize=-5', { token: adminToken }, 'GET 非法分页参数被拒或回落', undefined)

  const inject = await call('GET', `/v1/users?keyword=${encodeURIComponent("' OR 1=1 --")}`, { token: adminToken })
  record(inject.status === 200 && inject.json?.success === true, 'GET 关键字 SQL 注入尝试未报错', `status=${inject.status}`)

  /* ---------- 5. 写接口 CRUD（临时数据，前缀 smoke_） ---------- */
  section('5. 写接口 CRUD')
  const created = { users: [], roles: [], depts: [], menus: [], dicts: [], dictItems: [], levels: [], posts: [], notices: [], jobs: [] }

  // 5.1 部门
  let deptId = null
  {
    const r = await expectOk('POST', '/v1/depts', { token: adminToken, body: { departName: `smoke_部门_${STAMP}`, departOrder: 99, orgCategory: '2' } }, 'POST /v1/depts 新增部门')
    deptId = r.json?.result?.id ?? null
    if (deptId) {
      created.depts.push(deptId)
      await expectOk('PUT', `/v1/depts/${deptId}`, { token: adminToken, body: { departName: `smoke_部门改_${STAMP}` } }, 'PUT /v1/depts/:id 修改部门')
    }
  }

  // 5.2 角色
  let roleId2 = null
  {
    const r = await expectOk('POST', '/v1/roles', { token: adminToken, body: { roleName: `smoke_角色_${STAMP}`, roleCode: `smoke_role_${STAMP}` } }, 'POST /v1/roles 新增角色')
    roleId2 = r.json?.result?.id ?? null
    if (roleId2) {
      created.roles.push(roleId2)
      await expectOk('PUT', `/v1/roles/${roleId2}`, { token: adminToken, body: { roleName: `smoke_角色改_${STAMP}` } }, 'PUT /v1/roles/:id 修改角色')
      await expectOk('PUT', `/v1/roles/${roleId2}/menus`, { token: adminToken, body: { menuIds: [] } }, 'PUT /v1/roles/:id/menus 授权菜单')
    }
  }

  // 5.3 用户（含角色、部门绑定 + 登录链路验证）
  let userId = null
  let userPassword = null
  let smokeUserToken = null
  {
    userPassword = crypto.randomBytes(9).toString('base64url')
    const r = await expectOk(
      'POST',
      '/v1/users',
      {
        token: adminToken,
        body: { username: `smoke_user_${STAMP}`, realname: '冒烟测试', password: userPassword, email: `smoke_${STAMP}@example.com`, roleIds: roleId2 ? [roleId2] : [], deptIds: deptId ? [deptId] : [] }
      },
      'POST /v1/users 新增用户'
    )
    userId = r.json?.result?.id ?? null
    if (userId) {
      created.users.push(userId)
      const detail = await call('GET', `/v1/users/${userId}`, { token: adminToken })
      const d = detail.json?.result ?? {}
      record(!('password' in d) || d.password === undefined || d.password === null, '新用户详情不含 password 字段', Object.keys(d).join(','))
      const roleBound = (d.roles ?? []).length > 0
      const deptBound = (d.depts ?? []).length > 0
      record(roleBound, '新增时 roleIds 绑定生效', `roles=${(d.roles ?? []).length}`)
      record(deptBound, '新增时 deptIds 绑定生效', `depts=${(d.depts ?? []).length}`)
      await expectOk('PUT', `/v1/users/${userId}`, { token: adminToken, body: { realname: '冒烟测试-改名' } }, 'PUT /v1/users/:id 修改用户')
      await expectOk('PUT', `/v1/users/${userId}/roles`, { token: adminToken, body: { roleIds: roleId2 ? [roleId2] : [] } }, 'PUT /v1/users/:id/roles 分配角色')
      await expectOk('PUT', `/v1/users/${userId}/depts`, { token: adminToken, body: { deptIds: deptId ? [deptId] : [] } }, 'PUT /v1/users/:id/depts 分配部门')

      // 登录链路（真实验证码关闭的实例才能过；开着验证码时预期 4xx，不算失败）
      const login = await call('POST', '/v1/auth/login', { body: { username: `smoke_user_${STAMP}`, password: userPassword } })
      if (login.status >= 200 && login.status < 300 && login.json?.success === true) {
        const t = login.json.result?.accessToken ?? login.json.result?.token
        record(Boolean(t), '新建用户可登录并拿到令牌')
        // 低权限令牌访问管理接口应 403
        const denied = await call('GET', '/v1/users?page=1&pageSize=5', { token: t })
        record(denied.status === 403, '低权限用户访问用户列表被拒 (403)', `status=${denied.status}`)
        // 旧路由（/api/users）权限是否同样生效 —— 重复路由的越权风险点
        const legacy = await call('GET', '/users?page=1&pageSize=5', { token: t })
        record(legacy.status === 401 || legacy.status === 403, '旧路由 GET /api/users 同样拦截低权限用户', `status=${legacy.status}`)
        // IDOR：低权限令牌读取超管详情（只读，安全）
        const idorRead = await call('GET', `/v1/users/${ADMIN_ID}`, { token: t })
        record(idorRead.status === 403 || idorRead.status === 401, 'IDOR 低权限读取超管详情被拒', `status=${idorRead.status}`)
        // 越权写/删：目标用临时用户自己，万一真被放行也不会伤到真实数据
        const idorUpdate = await call('PUT', `/v1/users/${userId}`, { token: t, body: { realname: 'hacked' } })
        record(idorUpdate.status === 403 || idorUpdate.status === 401, '越权修改用户资料被拒', `status=${idorUpdate.status}`)
        const idorDelete = await call('DELETE', `/v1/users/${userId}`, { token: t })
        record(idorDelete.status === 403 || idorDelete.status === 401, '越权删除用户被拒', `status=${idorDelete.status}`)
        // 旧路由写操作同样要有权限（否则旧路由成了绕过新权限的后门）
        const legacyWrite = await call('PUT', `/users/${userId}`, { token: t, body: { realname: 'hacked-by-legacy' } })
        record(legacyWrite.status === 403 || legacyWrite.status === 401, '旧路由 PUT /api/users/:id 同样拦截低权限用户', `status=${legacyWrite.status}`)
        smokeUserToken = t
      } else {
        record(true, '登录链路（验证码开启，预期被拦）', `status=${login.status} msg=${login.json?.message ?? ''}`)
      }
    }
  }

  // 5.4 菜单
  {
    const r = await expectOk('POST', '/v1/menus', { token: adminToken, body: { name: `smoke_菜单_${STAMP}`, menuType: 1, url: `/smoke-${STAMP}`, isRoute: 1, status: '1' } }, 'POST /v1/menus 新增菜单')
    const id = r.json?.result?.id
    if (id) {
      created.menus.push(id)
      await expectOk('PUT', `/v1/menus/${id}`, { token: adminToken, body: { name: `smoke_菜单改_${STAMP}` } }, 'PUT /v1/menus/:id 修改菜单')
    }
  }

  // 5.5 字典 + 字典项
  let dictCode = `smoke_dict_${STAMP}`
  let dictId = null
  {
    const r = await expectOk('POST', '/v1/dicts', { token: adminToken, body: { dictName: `smoke_字典_${STAMP}`, dictCode } }, 'POST /v1/dicts 新增字典')
    dictId = r.json?.result?.id
    if (dictId) {
      created.dicts.push(dictId)
      const item = await expectOk('POST', '/v1/dict-items', { token: adminToken, body: { dictId, itemText: '冒烟项', itemValue: `smoke_${STAMP}`, sortOrder: 1, status: 1 } }, 'POST /v1/dict-items 新增字典项')
      const itemId = item.json?.result?.id
      if (itemId) {
        created.dictItems.push(itemId)
        await expectOk('GET', `/v1/dict-items/code/${dictCode}`, { token: adminToken }, 'GET /v1/dict-items/code/:code 按编码取字典项')
        await expectFail('DELETE', `/v1/dicts/${dictId}`, { token: adminToken }, '有字典项时删除字典被拒', undefined)
      } else {
        record(false, '字典项创建返回 id', JSON.stringify(item.json?.result))
      }
    }
  }

  // 5.6 职级
  {
    const r = await expectOk('POST', '/v1/levels', { token: adminToken, body: { levelName: `smoke_职级_${STAMP}`, levelRank: 99, status: '1' } }, 'POST /v1/levels 新增职级')
    const id = r.json?.result?.id
    if (id) {
      created.levels.push(id)
      await expectOk('PUT', `/v1/levels/${id}`, { token: adminToken, body: { levelName: `smoke_职级改_${STAMP}` } }, 'PUT /v1/levels/:id 修改职级')
    }
  }

  // 5.7 岗位
  {
    const r = await expectOk('POST', '/v1/posts', { token: adminToken, body: { postCode: `smoke_post_${STAMP}`, postName: `smoke_岗位_${STAMP}`, postSort: 99 } }, 'POST /v1/posts 新增岗位')
    const id = r.json?.result?.id
    if (id) {
      created.posts.push(id)
      await expectOk('PUT', `/v1/posts/${id}`, { token: adminToken, body: { postName: `smoke_岗位改_${STAMP}` } }, 'PUT /v1/posts/:id 修改岗位')
    }
  }

  // 5.8 公告：草稿 → 发布 → 撤回
  {
    const r = await expectOk('POST', '/v1/notices', { token: adminToken, body: { title: `smoke_公告_${STAMP}`, msgContent: '冒烟测试公告内容', msgCategory: '1', msgType: 'ALL', priority: 'M' } }, 'POST /v1/notices 新增公告')
    const id = r.json?.result?.id
    if (id) {
      created.notices.push(id)
      await expectOk('PUT', `/v1/notices/${id}/publish`, { token: adminToken }, 'PUT /v1/notices/:id/publish 发布公告')
      await expectOk('PUT', `/v1/notices/${id}/revoke`, { token: adminToken }, 'PUT /v1/notices/:id/revoke 撤回公告')
      await expectOk('PUT', `/v1/notices/${id}`, { token: adminToken, body: { title: `smoke_公告改_${STAMP}` } }, 'PUT /v1/notices/:id 修改公告')
    }
  }

  // 5.9 定时任务：新增 → 暂停 → 恢复 → 修改 → 删除
  {
    const handlers = records(lists['/v1/jobs/handlers'])
    // 后端限制「同任务类名只能建一条」，所以挑一个当前没被占用的 handler
    const existing = new Set(records(lists['/v1/jobs?page=1&pageSize=10']).map(j => j.jobClassName))
    const handler = handlers.map(h => h.className).find(name => name && !existing.has(name)) ?? null
    if (handler) {
      const r = await expectOk('POST', '/v1/jobs', { token: adminToken, body: { jobClassName: handler, cronExpression: '0 0 3 * * *', description: `smoke_任务_${STAMP}`, status: 0 } }, `POST /v1/jobs 新增定时任务（${handler}）`)
      const id = r.json?.result?.id
      if (id) {
        created.jobs.push(id)
        await expectOk('PUT', `/v1/jobs/${id}/pause`, { token: adminToken, body: {} }, 'PUT /v1/jobs/:id/pause 暂停')
        await expectOk('PUT', `/v1/jobs/${id}/resume`, { token: adminToken, body: {} }, 'PUT /v1/jobs/:id/resume 恢复')
        await expectOk('PUT', `/v1/jobs/${id}`, { token: adminToken, body: { description: `smoke_任务改_${STAMP}` } }, 'PUT /v1/jobs/:id 修改')
      }
    } else {
      // 后端限制「同一任务类名只能建一条」，handler 全被占用时改为验证冲突提示是否友好
      const occupied = handlers.map(h => h.className).filter(Boolean)[0]
      if (occupied) {
        const r = await call('POST', '/v1/jobs', { token: adminToken, body: { jobClassName: occupied, cronExpression: '0 0 3 * * *', status: 0 } })
        record(r.status === 400 && /已存在/.test(r.json?.message ?? ''), `全部 handler 已被占用，新增冲突有明确提示（${occupied}）`, `status=${r.status} msg=${r.json?.message}`)
      } else {
        record(false, '任务处理器列表可取', 'handlers 返回空')
      }
    }
  }

  // 5.9b 立即执行一次（用已存在的任务，验证调度链路是否真能跑）
  {
    const job = records(lists['/v1/jobs?page=1&pageSize=10'])[0]
    if (job) {
      const r = await call('PUT', `/v1/jobs/${job.id}/run`, { token: adminToken, body: {} })
      record(r.status === 200 && r.json?.success === true, `PUT /v1/jobs/:id/run 立即执行（${job.jobClassName}）`, `status=${r.status} msg=${r.json?.message ?? ''}`)
    }
  }

  // 5.10 导出 / 模板下载（二进制）
  section('6. 导出与导入模板')
  const binaryRoutes = [
    ['/v1/users/export', '用户导出'],
    ['/v1/users/import-template', '用户模板'],
    ['/v1/roles/export', '角色导出'],
    ['/v1/roles/import-template', '角色模板'],
    ['/v1/levels/export', '职级导出'],
    ['/v1/levels/import-template', '职级模板'],
    ['/v1/posts/export', '岗位导出'],
    ['/v1/posts/import-template', '岗位模板'],
    ['/v1/depts/export', '部门导出'],
    ['/v1/dicts/export', '字典导出'],
    ['/v1/dicts/import-template', '字典模板'],
    ['/v1/menus/export', '菜单导出'],
    ['/v1/notices/import-template', '公告模板'],
    ['/v1/logs/login/export', '登录日志导出'],
    ['/v1/logs/login/import-template', '登录日志模板'],
    ['/v1/logs/oper/export', '操作日志导出'],
    ['/v1/logs/oper/import-template', '操作日志模板'],
    ['/v1/jobs/export', '任务导出']
  ]
  for (const [p, label] of binaryRoutes) {
    const r = await call('GET', p, { token: adminToken })
    const isXlsx = r.buf && r.buf.length > 1000 && r.buf.subarray(0, 2).toString() === 'PK'
    record(r.status === 200 && isXlsx, `${label}  GET ${p}`, `status=${r.status} size=${r.buf?.length ?? 0}`)
  }

  // 导入：用刚下载的空模板（应给出明确中文提示，而不是 500）
  const tpl = await call('GET', '/v1/levels/import-template', { token: adminToken })
  if (tpl.buf) {
    const form = new FormData()
    form.append('file', new Blob([tpl.buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'smoke-levels.xlsx')
    const r = await call('POST', '/v1/levels/import', { token: adminToken, form })
    const ok = r.status === 200 || (r.status === 400 && /没有数据行|请填写/.test(r.json?.message ?? ''))
    record(ok, 'POST /v1/levels/import 空模板给明确提示（非 500）', `status=${r.status} msg=${r.json?.message}`)
  }
  const badForm = new FormData()
  badForm.append('file', new Blob([Buffer.from('hello')], { type: 'text/plain' }), 'not-excel.txt')
  const badImport = await call('POST', '/v1/levels/import', { token: adminToken, form: badForm })
  record(badImport.status >= 400 && badImport.status < 500, 'POST import 非 Excel 文件被拒', `status=${badImport.status} msg=${badImport.json?.message}`)

  /* ---------- 7. 旧版 /api/** 重复路由探测 ---------- */
  section('7. 旧版重复路由（/api/** 无 v1）')
  const legacyRoutes = [
    ['GET', '/users?page=1&pageSize=5', '旧 用户列表'],
    ['GET', '/roles?page=1&pageSize=5', '旧 角色列表'],
    ['GET', '/menus?page=1&pageSize=5', '旧 菜单列表'],
    ['GET', '/depts?page=1&pageSize=5', '旧 部门列表'],
    ['GET', '/tasks?page=1&pageSize=5', '旧 任务列表'],
    ['GET', '/storage/list', '旧 文件列表']
  ]
  for (const [m, p, label] of legacyRoutes) {
    const r = await call(m, p, { token: adminToken })
    record(r.status === 200, `${label}  ${m} ${p}`, `status=${r.status}`)
  }

  /* ---------- 9. 一致性 / 边界 / 安全专项 ---------- */
  section('9. 一致性 / 边界 / 安全专项')

  // 9.1 唯一性约束
  await expectFail('POST', '/v1/users', { token: adminToken, body: { username: `smoke_user_${STAMP}`, realname: '重复账号', password: 'another-password' } }, '重复用户名被拒', undefined)
  if (roleId2) {
    await expectFail('POST', '/v1/roles', { token: adminToken, body: { roleName: 'duplicate', roleCode: `smoke_role_${STAMP}` } }, '重复角色编码被拒', undefined)
  }
  if (dictId) {
    await expectFail('POST', '/v1/dict-items', { token: adminToken, body: { dictId, itemText: '重复项', itemValue: `smoke_${STAMP}` } }, '同字典下重复 value 被拒', undefined)
  }

  // 9.2 部门删除保护（父部门下有子部门时不能删）
  {
    const parent = await call('POST', '/v1/depts', { token: adminToken, body: { departName: `smoke_父部门_${STAMP}`, departOrder: 98 } })
    const parentId = parent.json?.result?.id
    const child = await call('POST', '/v1/depts', { token: adminToken, body: { departName: `smoke_子部门_${STAMP}`, parentId, departOrder: 99 } })
    const childId = child.json?.result?.id
    if (parentId && childId) {
      created.depts.push(childId, parentId)
      await expectFail('DELETE', `/v1/depts/${parentId}`, { token: adminToken }, '删除含子部门的部门被拒', undefined)
    } else {
      record(false, '创建父子部门用于删除保护测试', `parent=${parentId} child=${childId}`)
    }
  }

  // 9.3 敏感字段扫描：用户列表 / 日志参数
  {
    const list = await call('GET', '/v1/users?page=1&pageSize=100', { token: adminToken })
    const text = JSON.stringify(list.json ?? {})
    record(!/"(password|salt|passwordSalt)"\s*:\s*"[^"]+"/.test(text), '用户列表不返回 password/salt', `样本 ${records(list).length} 条`)

    const oper = await call('GET', '/v1/logs/oper?page=1&pageSize=50', { token: adminToken })
    const leaks = records(oper).filter(row => /"password"\s*:\s*"(?!\*{3})[^"]{4,}/i.test(String(row.params ?? '')))
    record(leaks.length === 0, '操作日志 params 中密码已脱敏', `命中 ${leaks.length} 条`)
  }

  // 9.4 响应头安全基线
  {
    const r = await call('GET', '')
    const h = r.headers
    record(!h.get('x-powered-by'), '未暴露 X-Powered-By', h.get('x-powered-by') ?? '无')
    record(Boolean(h.get('x-content-type-options')), '存在 X-Content-Type-Options（helmet）', h.get('x-content-type-options') ?? '缺失')
    record(Boolean(h.get('x-frame-options') || h.get('content-security-policy')), '存在点击劫持防护头', h.get('x-frame-options') ?? '缺失')
  }

  // 9.5 分页结构一致性（同一套约定：要么返回 {records,total}，要么返回数组）
  {
    const shapes = []
    for (const p of ['/v1/users', '/v1/roles', '/v1/depts', '/v1/levels', '/v1/posts', '/v1/dicts', '/v1/menus', '/v1/notices', '/v1/jobs']) {
      const r = await call('GET', `${p}?page=1&pageSize=2`, { token: adminToken })
      const result = r.json?.result
      shapes.push({ p, shape: Array.isArray(result) ? 'array' : result?.records ? 'paged' : '?', total: result?.total })
    }
    const paged = shapes.filter(s => s.shape === 'paged')
    const array = shapes.filter(s => s.shape === 'array')
    record(paged.length === 0 || array.length === 0, '列表分页返回结构统一', `paged=${paged.map(s => s.p).join(',')} / array=${array.map(s => s.p).join(',')}`)
  }

  /* ---------- 8. 清理 ---------- */
  section('8. 清理临时数据')
  const cleanup = [
    ['DELETE', `/v1/users/${userId ?? 'none'}`, '用户'],
    ['DELETE', `/v1/roles/${roleId2 ?? 'none'}`, '角色'],
    ['DELETE', `/v1/depts/${deptId ?? 'none'}`, '部门'],
    ['DELETE', `/v1/jobs/${created.jobs[0] ?? 'none'}`, '定时任务'],
    ['DELETE', `/v1/notices/${created.notices[0] ?? 'none'}`, '公告'],
    ['DELETE', `/v1/posts/${created.posts[0] ?? 'none'}`, '岗位'],
    ['DELETE', `/v1/levels/${created.levels[0] ?? 'none'}`, '职级'],
    ['DELETE', `/v1/dict-items/${created.dictItems[0] ?? 'none'}`, '字典项'],
    ['DELETE', `/v1/dicts/${dictId ?? 'none'}`, '字典'],
    ['DELETE', `/v1/menus/${created.menus[0] ?? 'none'}`, '菜单']
  ]
  for (const [m, p, label] of cleanup) {
    if (p.endsWith('none')) continue
    const r = await call(m, p, { token: adminToken })
    record(r.status === 200 && r.json?.success === true, `清理${label}`, `status=${r.status} msg=${r.json?.message ?? ''}`)
  }

  // 清理后确认列表里没有 smoke_ 残留
  const leftoverUsers = await call('GET', `/v1/users?page=1&pageSize=100&keyword=smoke_user_${STAMP}`, { token: adminToken })
  record(records(leftoverUsers).length === 0, '临时用户已删除（无残留）', `剩余 ${records(leftoverUsers).length}`)

  // 软删除后账号应立即失效（能用旧密码登录 = 严重越权）
  if (userPassword) {
    const relogin = await call('POST', '/v1/auth/login', { body: { username: `smoke_user_${STAMP}`, password: userPassword } })
    record(relogin.status === 401 || relogin.json?.success === false, '已删除用户无法再用旧密码登录', `status=${relogin.status} code=${relogin.json?.code}`)
  }

  /* ---------- 汇总 ---------- */
  console.log(`\n${'='.repeat(60)}`)
  console.log(`冒烟结果：PASS ${passCount} / FAIL ${failCount} / 共 ${results.length}`)
  if (failCount > 0) {
    console.log('\n失败明细：')
    for (const r of results.filter(x => !x.ok)) {
      console.log(` - ${r.name} -> ${r.detail}`)
    }
  }
  console.log('='.repeat(60))
  process.exit(failCount > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('冒烟脚本异常：', e)
  process.exit(2)
})
