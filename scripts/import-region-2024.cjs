/**
 * 行政区划全量数据导入（2024 年国家统计局五级区划，前四级）
 *
 * 数据源：https://github.com/adyliu/china_area（area_code_2024.csv.gz）
 *   CSV 格式：code,name,deep,parent_code,urban_rural_flag
 *   deep 1=省 2=市 3=区县 4=镇街（deep 5 村居不导入）
 *
 * 用法：
 *   1. 下载并解压数据：curl -L -o /tmp/area_code_2024.csv.gz
 *      https://raw.githubusercontent.com/adyliu/china_area/master/area_code_2024.csv.gz
 *      gunzip /tmp/area_code_2024.csv.gz
 *   2. 生成 SQL：node scripts/import-region-2024.cjs /tmp/area_code_2024.csv /tmp/region-import.sql
 *   3. 执行（重复执行安全，INSERT IGNORE 按 area_code 唯一键去重）：
 *      mysql -uroot -p --default-character-set=utf8mb4 concise_server < /tmp/region-import.sql
 *
 * 说明：
 *   - 拼音用 pinyin-pro 生成（需 npm i -g pinyin-pro 或在本目录临时安装），
 *     拼音仅用于关键字搜索，两字重名（山西/陕西同 ShanXi）不影响
 *   - 已存在的行（如迁移预置的 34 省）不会被覆盖
 *   - 港澳台不在国家统计局数据内，由迁移预置（国标码 710000/810000/820000000000）
 */
const fs = require('fs')

const { pinyin } = (() => {
  try {
    return require('pinyin-pro')
  } catch {
    console.error('请先安装 pinyin-pro：npm install pinyin-pro（或全局安装后设 NODE_PATH）')
    process.exit(1)
  }
})()

const [, , csvPath = '/tmp/area_code_2024.csv', outPath = '/tmp/region-import.sql'] = process.argv
const LEVEL_MAP = { 1: 0, 2: 1, 3: 2, 4: 3 }
const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

const rows = []
let skipped = 0
for (const line of fs.readFileSync(csvPath, 'utf8').split('\n')) {
  const t = line.trim()
  if (!t) continue
  const [code, name, deep, parent] = t.split(',')
  const level = LEVEL_MAP[Number(deep)]
  if (level === undefined) {
    skipped++
    continue
  }
  const py = /^[a-z]+$/.test(name) ? name : pinyin(name, { toneType: 'none', type: 'array' }).join('')
  let levelText = '街道'
  if (level === 3) {
    if (name.endsWith('乡') && !name.endsWith('城乡')) levelText = '乡'
    else if (name.endsWith('镇')) levelText = '镇'
  } else {
    levelText = ['省份', '城市', '区县'][level]
  }
  rows.push([code, name, level, levelText, parent, py])
}

const cols = '(`area_code`,`name`,`level`,`level_text`,`parent_code`,`city_code`,`zip_code`,`short_name`,`full_name`,`pinyin`,`pid`,`create_time`)'
const values = rows.map(
  ([code, name, level, levelText, parent, py]) =>
    `('${esc(code)}','${esc(name)}',${level},'${esc(levelText)}','${esc(parent)}','','','${esc(name)}','${esc(name)}','${esc(py)}',0,NOW())`
)
const parts = []
for (let i = 0; i < values.length; i += 500) {
  parts.push(`INSERT IGNORE INTO \`sys_region\` ${cols} VALUES\n${values.slice(i, i + 500).join(',\n')};\n`)
}
fs.writeFileSync(outPath, `SET NAMES utf8mb4;\nSTART TRANSACTION;\n${parts.join('\n')}COMMIT;\n`)

const byLevel = {}
for (const r of rows) byLevel[r[2]] = (byLevel[r[2]] || 0) + 1
console.log(`rows=${rows.length} byLevel=${JSON.stringify(byLevel)} skipped(村居)=${skipped}`)
console.log(`SQL 已写入 ${outPath}（${parts.length} 批），执行后用 SELECT level,COUNT(*) FROM sys_region GROUP BY level 对账`)
