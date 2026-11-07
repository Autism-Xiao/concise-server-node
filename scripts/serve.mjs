#!/usr/bin/env node
/**
 * 启动 dist/main.js，启动前自动结束占用同一端口的旧实例。
 *
 * 背景：本地反复 `node dist/main.js` 时，上一次的进程没退干净就报
 * `EADDRINUSE: address already in use :::3459`，每次都要手动查 PID + taskkill。
 *
 * 用法：
 *   node scripts/serve.mjs                 端口取 process.env.PORT / .env 的 PORT / 3000
 *   node scripts/serve.mjs --port 3460     临时换端口（会传给子进程）
 *   node scripts/serve.mjs --force         连"不是本项目的占用者"也一起结束（慎用）
 *   node scripts/serve.mjs --dry-run       只打印占用情况，不做任何结束动作
 *
 * 安全线：只有命令行形如 `node ... dist/main.js` / `node ... dist/main` / `nest start`
 * 的进程才会被自动结束；被别的程序（哪怕是 node 但跑的是别的脚本）占着时直接报错退出，
 * 不误杀。绝对路径形式的入口还必须落在本仓库内。
 */
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const rootPosix = root.replace(/\\/g, '/').toLowerCase()

const argv = process.argv.slice(2)

function option(name, fallback) {
  const index = argv.indexOf(name)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
}

function readEnvFile(file) {
  const result = {}
  if (!fs.existsSync(file)) return result
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const matched = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!matched) continue
    result[matched[1]] = matched[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return result
}

const fileEnv = readEnvFile(path.join(root, '.env'))
const portArg = option('--port')
const port = Number(portArg ?? process.env.PORT ?? fileEnv.PORT ?? 3000)
const entry = path.resolve(root, option('--entry', 'dist/main.js'))
const force = argv.includes('--force')
const dryRun = argv.includes('--dry-run')

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 端口能不能绑上（能绑 = 没人占） */
function canBind(targetPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', error => {
      if (error.code === 'EADDRINUSE') resolve(false)
      else reject(error)
    })
    server.listen(targetPort, () => server.close(() => resolve(true)))
  })
}

/** 找出监听指定端口的 PID（只用于诊断与结束，判占用以 canBind 为准） */
function findListeningPids(targetPort) {
  if (process.platform === 'win32') {
    const output = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true })
    const pids = new Set()
    for (const line of output.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue
      const columns = line.trim().split(/\s+/)
      const local = columns[1] ?? ''
      if (!local.endsWith(`:${targetPort}`)) continue
      const pid = Number(columns[columns.length - 1])
      if (Number.isInteger(pid) && pid > 0) pids.add(pid)
    }
    return [...pids]
  }
  try {
    const output = execFileSync('lsof', ['-t', `-iTCP:${targetPort}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
    return output
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter(pid => Number.isInteger(pid) && pid > 0)
  } catch {
    return []
  }
}

/** 取进程名与完整命令行；拿不到返回空串 */
function describe(pid) {
  try {
    if (process.platform === 'win32') {
      const script = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { "$($p.Name)|$($p.CommandLine)" }`
      const output = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim()
      const separator = output.indexOf('|')
      return {
        name: separator >= 0 ? output.slice(0, separator) : output,
        commandLine: separator >= 0 ? output.slice(separator + 1) : ''
      }
    }
    const commandLine = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim()
    return { name: '', commandLine }
  } catch {
    return { name: '', commandLine: '' }
  }
}

/** 命令行是否属于"本项目的后端实例" */
function isOurInstance(commandLine) {
  if (!commandLine) return false
  const normalized = commandLine.replace(/\\/g, '/').toLowerCase()
  const launchedByNode = normalized.includes('node.exe') || /(^|[\s"&])node(\s|$)/.test(normalized)
  if (!launchedByNode) return false
  const hitsEntry = /dist\/main(\.js)?(\s|$)/.test(normalized) || normalized.includes('nest start')
  if (!hitsEntry) return false
  const absolute = normalized.match(/[a-z]:\/[^\s"]*dist\/main(\.js)?/)
  return absolute ? absolute[0].includes(rootPosix) : true
}

function killPid(pid) {
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return
  }
  process.kill(pid, 'SIGKILL')
}

async function waitPortFree(targetPort, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await canBind(targetPort)) return true
    await sleep(200)
  }
  return canBind(targetPort)
}

async function releasePort() {
  if (await canBind(port)) return

  const pids = findListeningPids(port)
  if (pids.length === 0) {
    console.error(`[serve] 端口 ${port} 已被占用，但查不到占用进程（可能权限不足）。请用管理员终端执行 netstat -ano | findstr :${port}`)
    process.exit(1)
  }

  const victims = []
  for (const pid of pids) {
    const info = describe(pid)
    const ours = isOurInstance(info.commandLine)
    if (!ours && !force) {
      console.error(`[serve] 端口 ${port} 被其他程序占用，不是本项目的实例，未自动结束：`)
      console.error(`         pid=${pid}  ${info.name || '未知进程'}`)
      console.error(`         ${info.commandLine || '(读取不到命令行)'}`)
      console.error(`[serve] 请手动处理；确认无误可加 --force 强制结束`)
      process.exit(1)
    }
    victims.push({ pid, info })
  }

  for (const { pid, info } of victims) {
    // 老实例的 cmd 窗口标题通常就是项目名，打印出来方便确认杀对了
    console.log(`[serve] 端口 ${port} 被旧实例占用，结束 pid=${pid}（${info.commandLine || info.name || '未知'}）`)
    if (!dryRun) killPid(pid)
  }

  if (dryRun) {
    console.log('[serve] --dry-run：未执行结束动作，退出')
    process.exit(0)
  }

  if (!(await waitPortFree(port))) {
    console.error(`[serve] 旧实例已结束但端口 ${port} 仍不可用（可能进入了 TIME_WAIT 或被其他进程接管），请稍后重试`)
    process.exit(1)
  }
  console.log(`[serve] 端口 ${port} 已释放`)
}

async function main() {
  if (!fs.existsSync(entry)) {
    console.error(`[serve] 找不到入口 ${path.relative(root, entry)}，先执行 npm run build`)
    process.exit(1)
  }

  await releasePort()

  console.log(`[serve] 启动 ${path.relative(root, entry)}，PORT=${port}`)
  const child = spawn(process.execPath, [entry], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PORT: String(port) }
  })

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (!child.killed) child.kill(signal)
    })
  }

  child.on('exit', (code, signal) => {
    if (signal) console.log(`[serve] 子进程被信号 ${signal} 结束`)
    process.exit(code ?? 0)
  })
}

main().catch(error => {
  console.error('[serve] 启动失败：', error)
  process.exit(1)
})
