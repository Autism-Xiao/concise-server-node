/**
 * 出图采样：调 /auth/captcha 拿 N 组挑战，把 bgUrl / puzzleUrl 落成本地 PNG 供人工目检。
 * 用法：node scripts/captcha-sample.mjs [组数=6] [输出目录=.tmp-captcha]
 * 前置：实例已起（SMOKE_BASE，默认 http://localhost:3461/api/v1）
 */
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3461/api/v1'
const COUNT = Number(process.argv[2] ?? 6)
const OUT = process.argv[3] ?? '.tmp-captcha'

fs.mkdirSync(OUT, { recursive: true })

const save = (dataUrl, file) => fs.writeFileSync(path.join(OUT, file), Buffer.from(dataUrl.split(',')[1], 'base64'))

for (let i = 0; i < COUNT; i++) {
  const res = await fetch(`${BASE}/auth/captcha`)
  const json = await res.json()
  if (json.code !== 0) {
    console.error(`第 ${i + 1} 组失败：HTTP ${res.status} ${json.message}`)
    continue
  }
  const { captchaId, bgUrl, puzzleUrl } = json.result
  save(bgUrl, `bg-${String(i + 1).padStart(2, '0')}-${captchaId.slice(0, 8)}.png`)
  save(puzzleUrl, `piece-${String(i + 1).padStart(2, '0')}-${captchaId.slice(0, 8)}.png`)
  console.log(`ok #${i + 1} ${captchaId}`)
}
console.log(`\n输出目录：${path.resolve(OUT)}`)
