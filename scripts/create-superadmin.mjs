#!/usr/bin/env node
/**
 * 创建 / 提升平台超级管理员（唯一官方入口）
 *
 * 为什么不在 Web 页面上做：超管是「能建租户、能停服务、能代维看所有数据」的角色，
 * 一旦系统被攻破，攻击者若能自助注册超管，整个平台就没了。所以按行业惯例放到
 * **只有拿到服务器 SSH 权限的人**才能执行的 CLI 里。
 *
 * 用法：
 *   node scripts/create-superadmin.mjs --username superadmin --realname 平台超管
 *   SUPERADMIN_PASSWORD='xxx' node scripts/create-superadmin.mjs --username superadmin
 *   node scripts/create-superadmin.mjs --username admin --promote        # 提升已有账号
 *   node scripts/create-superadmin.mjs --username admin --reset-password # 重置已有超管密码
 *
 * 密码来源优先级：--password 参数 > SUPERADMIN_PASSWORD 环境变量 > 交互式隐藏输入。
 * 密码不会回显、不会写日志，只打印「已设置」。
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import crypto from 'node:crypto'

const require = createRequire(import.meta.url)
const mysql = require('mysql2/promise')

/** 项目根目录的 .env（本脚本从仓库根执行） */
function loadEnv() {
  const file = path.join(process.cwd(), '.env')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key] !== undefined) continue
    process.env[key] = rawValue.replace(/^["']|["']$/g, '')
  }
}

function parseArgs(argv) {
  const args = { promote: false, resetPassword: false }
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i]
    if (item === '--promote') args.promote = true
    else if (item === '--reset-password') args.resetPassword = true
    else if (item.startsWith('--')) {
      const key = item.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      args[key] = argv[++i]
    }
  }
  return args
}

/** 交互式读密码（不回显） */
function askPassword(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    const onData = (char) => {
      // 回车/换行结束输入；其余输入不打印
      if (char.toString() === '\n' || char.toString() === '\r' || char.toString() === '\u0004') {
        process.stdin.removeListener('data', onData)
      }
    }
    process.stdin.on('data', onData)
    rl.question(prompt, answer => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

/**
 * 口令哈希
 *
 * 与 UserService 用的是同一个实现与参数（@node-rs/argon2，argon2id，m=19456KiB / t=2 / p=1）。
 * 这里不 import 编译产物，是为了让脚本在「还没 build」的环境也能跑；
 * 兼容性由登录侧的 argon2 verify（从 PHC 串里读参数）保证。
 */
async function hashPassword(password) {
  const argon2 = require('@node-rs/argon2')
  return argon2.hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 })
}

async function main() {
  loadEnv()
  const args = parseArgs(process.argv.slice(2))
  const username = (args.username ?? '').trim()
  if (!username) {
    console.error('缺少 --username。示例：node scripts/create-superadmin.mjs --username superadmin --realname 平台超管')
    process.exit(1)
  }
  const realname = (args.realname ?? '平台管理员').trim()

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USERNAME ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'concise_server'
  })
  const [existingRows] = await connection.query('SELECT id, username, is_platform_admin, del_flag FROM sys_user WHERE username = ?', [username])
  const existing = existingRows[0]

  // ---------- 分支一：账号已存在 ----------
  if (existing) {
    if (!args.promote && !args.resetPassword) {
      console.error(`账号「${username}」已存在。若要提升为平台管理员加 --promote；若要重置密码加 --reset-password。`)
      await connection.end()
      process.exit(1)
    }
    if (args.resetPassword) {
      const password = args.password ?? process.env.SUPERADMIN_PASSWORD ?? (await askPassword(`为「${username}」设置新密码：`))
      if (!password || password.length < 8) {
        console.error('密码至少 8 位')
        await connection.end()
        process.exit(1)
      }
      await connection.query('UPDATE sys_user SET password = ?, salt = NULL, is_platform_admin = 1, status = 1, del_flag = 0 WHERE id = ?', [
        await hashPassword(password),
        existing.id
      ])
      console.log(`已重置「${username}」的密码，并确保其为平台管理员（id=${existing.id}）`)
    } else {
      await connection.query('UPDATE sys_user SET is_platform_admin = 1, status = 1, del_flag = 0 WHERE id = ?', [existing.id])
      console.log(`已把「${username}」提升为平台管理员（id=${existing.id}）`)
    }
    await connection.end()
    return
  }

  // ---------- 分支二：新建账号 ----------
  const password = args.password ?? process.env.SUPERADMIN_PASSWORD ?? (await askPassword(`为新的平台管理员「${username}」设置密码：`))
  if (!password || password.length < 8) {
    console.error('密码至少 8 位')
    await connection.end()
    process.exit(1)
  }
  const id = crypto.randomBytes(16).toString('hex')
  await connection.query(
    `INSERT INTO sys_user (id, username, realname, password, salt, status, del_flag, is_platform_admin, create_time)
     VALUES (?, ?, ?, ?, NULL, 1, 0, 1, NOW())`,
    [id, username, realname, await hashPassword(password)]
  )
  await connection.end()
  console.log(`已创建平台管理员「${username}」（id=${id}）。请立即登录并在「安全设置」里绑定两步验证。`)
}

main().catch(error => {
  console.error('执行失败：', error.message)
  process.exit(1)
})
