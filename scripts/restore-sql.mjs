#!/usr/bin/env node
/**
 * 从 SQL 快照恢复整个数据库（破坏性操作）
 *
 * 用法：
 *   node scripts/restore-sql.mjs sql/backups/xxx.sql          # 交互确认后恢复
 *   node scripts/restore-sql.mjs sql/backups/xxx.sql --yes    # 跳过确认（脚本/CI 用）
 *
 * 做的事：DROP + CREATE 空库 → 导入 → 比对表数。任一步失败立即退出，不留半吊子状态。
 * 恢复前务必确认已有一份当前库的备份 —— 这条命令没有撤销键。
 */
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import 'dotenv/config'

const MYSQL = process.env.MYSQL_PATH ?? 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe'
const host = process.env.DB_HOST ?? '127.0.0.1'
const port = process.env.DB_PORT ?? '3306'
const user = process.env.DB_USERNAME ?? 'root'
const password = process.env.DB_PASSWORD ?? ''
const database = process.env.DB_DATABASE ?? 'concise_server'

const args = process.argv.slice(2)
const target = args.find(item => !item.startsWith('--'))
const skipConfirm = args.includes('--yes')

if (!target) {
  console.error('✗ 用法：node scripts/restore-sql.mjs <快照文件.sql> [--yes]')
  process.exit(1)
}
const file = resolve(process.cwd(), target)
if (!existsSync(file)) {
  console.error(`✗ 文件不存在：${file}`)
  process.exit(1)
}
if (!existsSync(MYSQL)) {
  console.error(`✗ 找不到 mysql 客户端：${MYSQL}（用 MYSQL_PATH 指定）`)
  process.exit(1)
}

const sizeMb = (statSync(file).size / 1024 / 1024).toFixed(1)
const common = [`--host=${host}`, `--port=${port}`, `--user=${user}`, '--default-character-set=utf8mb4']
const env = { ...process.env, MYSQL_PWD: password }

/** 跑一条 SQL（不读输入） */
const exec = (sql, db) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(MYSQL, [...common, ...(db ? [db] : []), '-e', sql], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => (stderr += String(chunk)))
    child.on('close', code => (code === 0 ? resolvePromise() : rejectPromise(new Error(stderr.trim()))))
  })

/** 导入文件（流式） */
const importFile = () =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(MYSQL, [...common, database], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => (stderr += String(chunk)))
    createReadStream(file).pipe(child.stdin)
    child.on('close', code => (code === 0 ? resolvePromise() : rejectPromise(new Error(stderr.trim()))))
  })

const countTables = async db => {
  const child = spawn(MYSQL, [...common, '-N', '-e', `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${db}'`], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let out = ''
  child.stdout.on('data', chunk => (out += String(chunk)))
  return new Promise(resolvePromise => child.on('close', () => resolvePromise(Number(out.trim()) || 0)))
}

const confirm = async () => {
  if (skipConfirm) return true
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(resolvePromise => rl.question('即将清空并重建数据库，输入 YES 继续：', resolvePromise))
  rl.close()
  return answer.trim() === 'YES'
}

;(async () => {
  const currentTables = await countTables(database)
  console.log(`目标文件：${basename(file)}（${sizeMb} MB）`)
  console.log(`当前库  ：${database}，${currentTables} 张表将被清空`)
  if (!(await confirm())) {
    console.log('已取消')
    process.exit(2)
  }
  const startedAt = Date.now()
  console.log('1/3 重建空库…')
  await exec(`DROP DATABASE IF EXISTS \`${database}\`; CREATE DATABASE \`${database}\` COLLATE utf8mb4_unicode_ci;`)
  console.log('2/3 导入快照…')
  await importFile()
  const tables = await countTables(database)
  console.log(`3/3 校验：${tables} 张表（耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s）`)
  if (tables === 0) {
    console.error('✗ 导入后一张表都没有，文件可能不是完整转储')
    process.exit(1)
  }
  console.log('✓ 恢复完成')
})().catch(error => {
  console.error(`✗ 恢复失败：${error.message}`)
  process.exit(1)
})
