/**
 * 文件管理冒烟测试
 *
 * 用法：
 *   SMOKE_BASE=http://127.0.0.1:3460/api SMOKE_USER=admin SMOKE_PASSWORD=<登录密码> node scripts/smoke-file.mjs
 * 前提：目标实例已关闭验证码（CAPTCHA_ENABLED=false），否则登录拿不到 token。
 * 覆盖：建文件夹 → 上传中文名文件 → 列表/面包屑/统计 → 改名 → 星标 → 移动 → 下载 → 软删 → 回收站 → 恢复 → 彻底删除
 */
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3460/api'
const USERNAME = process.env.SMOKE_USER ?? 'admin'
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'admin123'
let token = ''
const results = []

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function api(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) }
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { res, json, text }
}

const login = await fetch(`${BASE}/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USERNAME, password: PASSWORD })
}).then(r => r.json())
token = login.result.accessToken
check('登录', !!token)

const FOLDER_NAME = `冒烟文件夹-${Date.now()}`
const folderRes = await api('/v1/files/folders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ parentId: 0, name: FOLDER_NAME })
})
check('新建文件夹', folderRes.json?.code === 0, folderRes.json?.message)
const folderId = folderRes.json?.result?.id

const dup = await api('/v1/files/folders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ parentId: 0, name: FOLDER_NAME })
})
check('同目录重名被拒', dup.res.status === 400 && !!dup.json?.message, `${dup.res.status} ${dup.json?.message}`)

const form = new FormData()
form.append('file', new Blob(['hello 文件管理 smoke test\n'], { type: 'text/plain' }), '中文报告.txt')
form.append('parentId', String(folderId))
form.append('onConflict', 'rename')
const upload = await api('/v1/files/upload', { method: 'POST', body: form })
check('上传文件', upload.json?.code === 0, upload.json?.message)
const fileNode = upload.json?.result?.file
check('中文文件名未乱码', fileNode?.name === '中文报告.txt', `实际：${fileNode?.name}`)
check('扩展名与大小', fileNode?.ext === 'txt' && fileNode?.size > 0, `${fileNode?.ext}/${fileNode?.size}`)

const folderList = await api(`/v1/files?parentId=${folderId}`)
check('目录列表', folderList.json?.result?.total === 1, `total=${folderList.json?.result?.total}`)

const crumb = await api(`/v1/files/breadcrumb?folderId=${folderId}`)
check('面包屑', crumb.json?.result?.length === 2, JSON.stringify(crumb.json?.result?.map(i => i.name)))

const stats = await api('/v1/files/stats')
check('统计接口', stats.json?.code === 0 && stats.json.result.quotaBytes > 0, `已用 ${stats.json?.result?.totalBytes} 字节 / 配额 ${stats.json?.result?.quotaBytes}`)

const renamed = await api(`/v1/files/${fileNode.id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: '改名后.md' })
})
check('改名（扩展名同步）', renamed.json?.result?.name === '改名后.md' && renamed.json?.result?.ext === 'md', `ext=${renamed.json?.result?.ext}`)

const starred = await api(`/v1/files/${fileNode.id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ starred: true })
})
check('星标', starred.json?.result?.isStarred === 1)
const starList = await api('/v1/files?starred=true')
check('星标跨目录视图', starList.json?.result?.total >= 1, `total=${starList.json?.result?.total}`)

const moved = await api(`/v1/files/${fileNode.id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ parentId: 0 })
})
check('移动到根目录', moved.json?.result?.parentId === 0)

const subRes = await api('/v1/files/folders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ parentId: folderId, name: '子目录' })
})
const subId = subRes.json?.result?.id
const cycle = await api(`/v1/files/${folderId}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ parentId: subId })
})
check('移动成环被拒', cycle.res.status === 400, `${cycle.res.status} ${cycle.json?.message}`)

const download = await fetch(`${BASE}/v1/files/${fileNode.id}/download`, { headers: { Authorization: `Bearer ${token}` } })
const body = await download.text()
const disposition = download.headers.get('content-disposition') ?? ''
check('下载内容一致', body.includes('smoke test'), `长度 ${body.length}`)
check('下载文件名编码', disposition.includes(encodeURIComponent('改名后.md')), disposition.slice(0, 80))
check('下载防嗅探头', download.headers.get('x-content-type-options') === 'nosniff')

const overlap = await api('/v1/files/upload', { method: 'POST', body: (() => {
  const again = new FormData()
  again.append('file', new Blob(['hello 文件管理 smoke test\n'], { type: 'text/plain' }), '改名后.md')
  again.append('parentId', '0')
  again.append('onConflict', 'rename')
  return again
})() })
check('同名自动改名', overlap.json?.result?.file?.name === '改名后(1).md', overlap.json?.result?.file?.name)

const removed = await api(`/v1/files/${fileNode.id}`, { method: 'DELETE' })
check('软删除', removed.json?.result?.deleted === 1)
const recycled = await api('/v1/files/recycled')
check('回收站可见', recycled.json?.result?.records?.some(r => r.id === fileNode.id))

const restored = await api('/v1/files/restore', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ids: [String(fileNode.id)] })
})
check('从回收站恢复', restored.json?.result?.restored >= 1)

const purged = await api('/v1/files/purge', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ids: [String(overlap.json?.result?.file?.id)] })
})
check('彻底删除', purged.json?.result?.purged === 1)

const bad = await api('/v1/files/9999999')
check('不存在返回 404', bad.json?.code === 404 || bad.res.status === 404, `${bad.json?.code}/${bad.res.status}`)

const cleanup = await api('/v1/files/purge', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ids: [String(folderId), String(fileNode.id)] })
})
check('清理冒烟数据（连子目录一起彻底删）', cleanup.json?.result?.purged >= 2, `purged=${cleanup.json?.result?.purged}`)

const failed = results.filter(r => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.log('失败项：', failed.map(f => f.name).join('、'))
  process.exitCode = 1
}
