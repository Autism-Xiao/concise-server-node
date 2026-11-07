/**
 * 文件管理冒烟测试
 *
 * 用法：
 *   SMOKE_BASE=http://127.0.0.1:3460/api SMOKE_USER=admin SMOKE_PASSWORD=<登录密码> node scripts/smoke-file.mjs
 * 前提：目标实例已关闭验证码（CAPTCHA_ENABLED=false），否则登录拿不到 token。
 * 覆盖：建文件夹 → 上传中文名文件 → 列表/面包屑/统计 → 改名 → 星标 → 移动 → 下载（含 Range）
 *      → 预览白名单 → 覆盖上传清盘 → 恢复重名改名 → 软删 → 回收站 → 恢复 → 彻底删除
 *
 * 注意：脚本需与后端同机运行 —— 覆盖清盘、物理文件存在性这类断言要直接读 storage 目录。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3460/api'
const USERNAME = process.env.SMOKE_USER ?? 'admin'
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'admin123'
let token = ''
const results = []

/** storage_key → 本地绝对路径（内容寻址，根目录默认 ./storage/files） */
function storagePath(storageKey) {
  const root = process.env.FILE_STORAGE_DIR?.trim() || path.join(PROJECT_ROOT, 'storage/files')
  return path.join(root, storageKey)
}

/** 文本文件上传表单（冒烟里大量重复构造） */
function textForm(name, content, parentId = 0, onConflict) {
  const form = new FormData()
  form.append('file', new Blob([content], { type: 'text/plain' }), name)
  form.append('parentId', String(parentId))
  if (onConflict) form.append('onConflict', onConflict)
  return form
}

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

// ---- Range：大文件拖动进度条 / 断点续传靠它 ----
const partial = await fetch(`${BASE}/v1/files/${fileNode.id}/download`, {
  headers: { Authorization: `Bearer ${token}`, Range: 'bytes=0-3' }
})
check('Range 返回 206', partial.status === 206, String(partial.status))
check('Range 响应头正确', (partial.headers.get('content-range') ?? '').startsWith('bytes 0-3/'), partial.headers.get('content-range') ?? '')
check('Range 内容为前 4 字节', (await partial.text()) === 'hell')

const badRange = await fetch(`${BASE}/v1/files/${fileNode.id}/download`, {
  headers: { Authorization: `Bearer ${token}`, Range: 'bytes=999999-' }
})
check('越界 Range 返回 416', badRange.status === 416, String(badRange.status))

// ---- 预览：只放行位图/PDF/纯文本，且类型要按文件头验真 ----
const textPreview = await fetch(`${BASE}/v1/files/${fileNode.id}/preview`, { headers: { Authorization: `Bearer ${token}` } })
const previewType = textPreview.headers.get('content-type') ?? ''
const previewDisposition = textPreview.headers.get('content-disposition') ?? ''
check('文本预览 200', textPreview.status === 200, String(textPreview.status))
check('预览为 inline + text/plain', previewDisposition.startsWith('inline') && previewType.includes('text/plain'), `${previewDisposition.slice(0, 20)} / ${previewType}`)

// 扩展名伪装成图片、内容其实是 HTML：必须被文件头校验拦下
const fakeForm = new FormData()
fakeForm.append('file', new Blob(['<html><script>alert(1)</script></html>'], { type: 'image/png' }), 'fake.png')
fakeForm.append('parentId', '0')
const fakeUpload = await api('/v1/files/upload', { method: 'POST', body: fakeForm })
const fakeId = fakeUpload.json?.result?.file?.id
const fakePreview = await fetch(`${BASE}/v1/files/${fakeId}/preview`, { headers: { Authorization: `Bearer ${token}` } })
check('伪装图片被拒预览', fakePreview.status === 400, `${fakePreview.status} ${(await fakePreview.text()).slice(0, 60)}`)

const zipForm = new FormData()
zipForm.append('file', new Blob(['PK\u0003\u0004 fake zip'], { type: 'application/zip' }), 'archive.zip')
zipForm.append('parentId', '0')
const zipUpload = await api('/v1/files/upload', { method: 'POST', body: zipForm })
const zipId = zipUpload.json?.result?.file?.id
const zipPreview = await fetch(`${BASE}/v1/files/${zipId}/preview`, { headers: { Authorization: `Bearer ${token}` } })
check('不支持的类型拒绝预览', zipPreview.status === 400, String(zipPreview.status))

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

// ---- 覆盖上传：旧内容的物理文件必须被回收，否则每覆盖一次漏一份磁盘 ----
const overwriteName = `覆盖-${Date.now()}.txt`
const firstVersion = await api('/v1/files/upload', { method: 'POST', body: textForm(overwriteName, '第一版', 0, 'overwrite') })
const overwriteId = firstVersion.json?.result?.file?.id
const firstKey = (await api(`/v1/files/${overwriteId}`)).json?.result?.storageKey
check('覆盖前物理文件存在', !!firstKey && fs.existsSync(storagePath(firstKey)), firstKey)

const secondVersion = await api('/v1/files/upload', { method: 'POST', body: textForm(overwriteName, '第二版内容更长一些，sha256 必然不同', 0, 'overwrite') })
const secondKey = (await api(`/v1/files/${overwriteId}`)).json?.result?.storageKey
check('覆盖复用同一条记录', secondVersion.json?.result?.file?.id === overwriteId, String(secondVersion.json?.result?.file?.id))
check('覆盖后旧物理文件已清盘', firstKey !== secondKey && !fs.existsSync(storagePath(firstKey)), `${firstKey} → ${secondKey}`)
check('覆盖后新物理文件存在', !!secondKey && fs.existsSync(storagePath(secondKey)))

// ---- 恢复重名：删除期间又建了同名文件，恢复要自动改名而不是造出两条同名 ----
const dupName = `恢复冲突-${Date.now()}.txt`
const older = await api('/v1/files/upload', { method: 'POST', body: textForm(dupName, '旧的那份', 0) })
const olderId = older.json?.result?.file?.id
await api(`/v1/files/${olderId}`, { method: 'DELETE' })
const newer = await api('/v1/files/upload', { method: 'POST', body: textForm(dupName, '新的那份', 0) })
const newerId = newer.json?.result?.file?.id
check('删除后可重新建同名', newer.json?.result?.file?.name === dupName, newer.json?.result?.file?.name)

const restoreDup = await api('/v1/files/restore', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ids: [String(olderId)] })
})
check('恢复时重名自动改名', (restoreDup.json?.result?.renamed ?? 0) >= 1, JSON.stringify(restoreDup.json?.result))
const restoredOlder = await api(`/v1/files/${olderId}`)
check('恢复后名字带序号', (restoredOlder.json?.result?.name ?? '').includes('(1)'), restoredOlder.json?.result?.name)

const bad = await api('/v1/files/9999999')
check('不存在返回 404', bad.json?.code === 404 || bad.res.status === 404, `${bad.json?.code}/${bad.res.status}`)

const cleanupIds = [folderId, fileNode.id, overwriteId, fakeId, zipId, olderId, newerId].filter(Boolean).map(String)
const cleanup = await api('/v1/files/purge', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ids: cleanupIds })
})
check('清理冒烟数据（连子目录一起彻底删）', cleanup.json?.result?.purged >= 2, `purged=${cleanup.json?.result?.purged} / 提交 ${cleanupIds.length} 个 id`)

const failed = results.filter(r => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.log('失败项：', failed.map(f => f.name).join('、'))
  process.exitCode = 1
}
