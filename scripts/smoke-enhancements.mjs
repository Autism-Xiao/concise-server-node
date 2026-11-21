/**
 * 四件套增强冒烟：短信通道 / 请求加密 / 演示只读账号
 *
 * 前置：服务以 ENCRYPT_ENABLED=true、CAPTCHA_ENABLED=false 启动；
 *       先跑过 node scripts/seed-tenant-demo.cjs && node scripts/seed-demo-viewer.cjs
 *
 * 用法：node scripts/smoke-enhancements.mjs
 */
import 'dotenv/config'
import crypto from 'node:crypto'
import mysql from 'mysql2/promise'

const BASE = 'http://127.0.0.1:3459/api'

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

async function api(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    // 非 JSON（原始文本端点）
  }
  return { status: res.status, json }
}

async function login(username, password) {
  const res = await api('/auth/login', { method: 'POST', body: { username, password } })
  if (res.json?.code !== 0) throw new Error(`登录失败：${res.json?.message}`)
  return res.json.result.accessToken
}

/** 信封加密（与前端 lib/request-encrypt.ts 同协议） */
async function encryptEnvelope(publicKeyPem, payload) {
  const sessionKey = await crypto.webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
  const iv = crypto.webcrypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const encrypted = new Uint8Array(await crypto.webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, sessionKey, plaintext))
  const rawSessionKey = new Uint8Array(await crypto.webcrypto.subtle.exportKey('raw', sessionKey))
  const spki = publicKeyPem.replace(/-----[^\n]+-----/g, '').replace(/\s+/g, '')
  const rsaKey = await crypto.webcrypto.subtle.importKey('spki', Buffer.from(spki, 'base64'), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
  const ek = new Uint8Array(await crypto.webcrypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsaKey, rawSessionKey))
  const b64 = bytes => Buffer.from(bytes).toString('base64')
  return { ek: b64(ek), iv: b64(iv), data: b64(encrypted) }
}

;(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
  })

  console.log('\n[1] 短信通道运维端点')
  const adminToken = await login('admin', 'admin123')
  const smsStatus = await api('/sms/status', { token: adminToken })
  ok(smsStatus.json?.code === 0 && smsStatus.json.result.provider === 'aliyun', `sms/status 返回通道默认 aliyun`)
  ok(smsStatus.json.result.configured === false && smsStatus.json.result.enabled === false, `未配凭证时 configured/enabled 均为 false（脱敏不炸）`)
  ok(smsStatus.json.result.aliyun.accessKeyId === null, `未配置时 KeyId 出镜为 null`)

  const smsTest = await api('/sms/test', { method: 'POST', token: adminToken, body: { to: '13800000000' } })
  ok(smsTest.json?.code === 0 && smsTest.json.result?.ok === false && /未配置/.test(smsTest.json.result?.error ?? ''), `未配置时 test 发送如实报「未配置」（不假成功）`)

  const smsOutbox = await api('/sms/outbox', { token: adminToken })
  ok(Array.isArray(smsOutbox.json?.result), `sms/outbox 返回记录数组`)

  // 权限：普通租户用户不应能看通道状态（system:config:list 是配置中心权限）
  console.log('\n[2] 请求加密（ENCRYPT_ENABLED=true 实弹）')
  const keyRes = await api('/auth/encrypt-key')
  ok(keyRes.json?.code === 0 && keyRes.json.result?.enabled === true, `encrypt-key 端点返回 enabled=true`)
  const publicKey = keyRes.json.result.publicKey
  ok(/BEGIN PUBLIC KEY/.test(publicKey ?? ''), `公钥为 PEM 文本`)

  // 正常加密登录
  const envelope = await encryptEnvelope(publicKey, { username: 'admin', password: 'admin123' })
  const encLogin = await api('/auth/login', { method: 'POST', body: envelope, headers: { 'X-Encrypted': 'aes-rsa-v1' } })
  ok(encLogin.json?.code === 0 && Boolean(encLogin.json.result?.accessToken), `信封加密登录成功（服务端解密链路通）`)

  // 篡改检测：data 翻转一个字节 → 解密必失败
  const tampered = { ...envelope }
  const raw = Buffer.from(tampered.data, 'base64')
  raw[0] ^= 0x01
  tampered.data = raw.toString('base64')
  const badLogin = await api('/auth/login', { method: 'POST', body: tampered, headers: { 'X-Encrypted': 'aes-rsa-v1' } })
  ok(badLogin.status === 400 || /解密失败/.test(badLogin.json?.message ?? ''), `篡改密文被拒（400/解密失败）`)

  // 坏信封（缺字段）
  const badShape = await api('/auth/login', { method: 'POST', body: { ek: 'x' }, headers: { 'X-Encrypted': 'aes-rsa-v1' } })
  ok(badShape.status === 400, `缺 iv/data 的坏信封被 400 拒绝`)

  // 明文登录仍然可用（加密是纯增强，不干扰既有客户端）
  const plainLogin = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })
  ok(plainLogin.json?.code === 0, `不带 X-Encrypted 的明文登录仍正常`)

  console.log('\n[3] 演示只读账号')
  const demoRes = await api('/auth/login', { method: 'POST', body: { username: 'demo_viewer', password: 'Demo@123456' } })
  ok(demoRes.json?.code === 0 && Boolean(demoRes.json.result?.accessToken), `demo_viewer / Demo@123456 可登录`)
  const demoToken = demoRes.json.result?.accessToken
  if (demoToken) {
    // 只读角色：读自己租户列表应通
    const listTenants = await api('/tenants/mine', { token: demoToken })
    ok(listTenants.json?.code === 0, `viewer 能读 mine（只读链路）`)
    // 写操作应被 PermsGuard 挡住
    const forbidden = await api('/users', { method: 'POST', token: demoToken, body: { username: 'x_hacker', password: 'x12345678' } })
    ok(forbidden.status === 403 || forbidden.json?.code !== 0, `viewer 创建用户被拒（403）`)
    // 不能越权看平台侧端点
    const dashboard = await api('/tenants/dashboard', { token: demoToken })
    ok(dashboard.status === 403 || dashboard.json?.code !== 0, `viewer 访问平台仪表盘被拒`)
  } else {
    ok(false, `demo_viewer 登录失败，无法继续只读断言`)
  }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  await conn.end()
  process.exit(failed ? 1 : 0)
})().catch(err => {
  console.error(err)
  process.exit(1)
})
