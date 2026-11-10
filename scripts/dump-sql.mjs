#!/usr/bin/env node
/**
 * 导出数据库转储到 sql/ 目录（按日期命名）
 *
 * 用法：
 *   node scripts/dump-sql.mjs              # 全量（结构 + 数据）→ sql/concise_server_full_YYYY-MM-DD.sql
 *   node scripts/dump-sql.mjs --schema-only # 只导结构 → sql/concise_server_schema_YYYY-MM-DD.sql
 *   node scripts/dump-sql.mjs --date=2026-11-10  # 指定文件名里的日期
 *
 * 连接信息全部取自 .env（DB_HOST / DB_PORT / DB_USERNAME / DB_PASSWORD / DB_DATABASE），
 * 密码通过 MYSQL_PWD 环境变量传给 mysqldump，**不写在命令行参数里**（否则会出现在进程列表
 * 和错误输出里，也会触发仓库的敏感信息检查）。
 *
 * mysqldump 路径可用环境变量 MYSQLDUMP_PATH 覆盖（默认 MySQL 8.4 的安装路径）。
 */
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import 'dotenv/config'

const MYSQLDUMP = process.env.MYSQLDUMP_PATH ?? 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysqldump.exe'

const host = process.env.DB_HOST ?? '127.0.0.1'
const port = process.env.DB_PORT ?? '3306'
const user = process.env.DB_USERNAME ?? 'root'
const database = process.env.DB_DATABASE ?? 'concise_server'
const password = process.env.DB_PASSWORD ?? ''

const args = process.argv.slice(2)
const schemaOnly = args.includes('--schema-only')
const dateArg = args.find(item => item.startsWith('--date='))?.slice('--date='.length)
// 本地时区日期（不能用 toISOString，那是 UTC，晚上导出会差一天）
const today = new Date().toLocaleDateString('sv-SE')
const stamp = dateArg ?? today

if (!existsSync(MYSQLDUMP) && !process.env.MYSQLDUMP_PATH) {
  console.error(`✗ 找不到 mysqldump：${MYSQLDUMP}\n  用 MYSQLDUMP_PATH 环境变量指定绝对路径`)
  process.exit(1)
}

const sqlDir = join(process.cwd(), 'sql')
mkdirSync(sqlDir, { recursive: true })
const outFile = join(sqlDir, `concise_server_${schemaOnly ? 'schema' : 'full'}_${stamp}.sql`)

// 与现有转储保持一致的选项：单事务一致性快照、逐行流式读取、不写表空间、不带 GTID
const dumpArgs = [
  `--host=${host}`,
  `--port=${port}`,
  `--user=${user}`,
  `--default-character-set=utf8mb4`,
  '--single-transaction',
  '--quick',
  '--no-tablespaces',
  '--set-gtid-purged=OFF',
  '--routines',
  '--events',
  '--triggers',
  '--hex-blob',
  ...(schemaOnly ? ['--no-data'] : []),
  database
]

console.log(`→ ${database}@${host}:${port} → ${outFile}${schemaOnly ? '（仅结构）' : ''}`)

const out = createWriteStream(outFile)
const child = spawn(MYSQLDUMP, dumpArgs, {
  env: { ...process.env, MYSQL_PWD: password },
  stdio: ['ignore', 'pipe', 'pipe']
})
child.stdout.pipe(out)

let stderr = ''
child.stderr.on('data', chunk => {
  stderr += String(chunk)
})

child.on('close', code => {
  out.end()
  if (code !== 0) {
    console.error(`✗ mysqldump 退出码 ${code}\n${stderr.replace(/^.*Using a password.*$/gm, '').trim()}`)
    process.exit(code ?? 1)
  }
  const size = (statSync(outFile).size / 1024 / 1024).toFixed(1)
  console.log(`✓ 完成：${outFile}（${size} MB）`)
})
