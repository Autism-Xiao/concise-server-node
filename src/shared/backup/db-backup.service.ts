import { spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'

import { Inject, Injectable, Logger } from '@nestjs/common'
import type { DataSourceOptions } from 'typeorm'

import { databaseConfig } from '../../config'
import { SystemConfigService } from '../../modules/system/config/system-config.service'

/** 只取 MySQL 连接参数：DataSourceOptions 是联合类型，直接访问 username/password 会报类型错 */
interface MySqlConn {
  host?: string
  port?: number
  username?: string
  password?: string
  database?: string
}

/** 只取 MySQL 连接参数：DataSourceOptions 是联合类型，直接访问 username/password 会报类型错 */
interface MySqlConn {
  host?: string
  port?: number
  username?: string
  password?: string
  database?: string
}

/** 备份产物信息 */
export interface BackupFileInfo {
  file: string
  sizeMb: number
  createdAt: string
}

export interface BackupResult extends BackupFileInfo {
  /** 校验出来的表数（未开启校验时为 null） */
  tables: number | null
  /** 是否通过导入校验 */
  verified: boolean
  /** 按保留策略删掉的旧备份数量 */
  pruned: number
  durationMs: number
}

/**
 * 数据库备份服务
 *
 * 兜的是「备份靠人手跑」这个洞：以前每次都是临时敲 mysqldump + 手工建临时库验证。
 * 现在做成可被定时任务调用的流程：导出 → 导入临时库校验 → 按保留策略清理。
 *
 * 不算「备份」的三种情况（这三点是本服务的设计前提）：
 * 1. 没导出成功 —— 直接抛错，不生成半截文件；
 * 2. 导出了但没验证 —— 每次导出后都在临时库真导入一遍，比对表数；
 * 3. 验证过但没保留策略 —— 无限增长迟早撑爆磁盘，默认只留最近 7 份。
 */
@Injectable()
export class DbBackupService {
  private readonly logger = new Logger(DbBackupService.name)
  private readonly mysqldumpPath = process.env.MYSQLDUMP_PATH ?? 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysqldump.exe'
  private readonly mysqlPath = process.env.MYSQL_PATH ?? 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe'

  constructor(
    @Inject(databaseConfig.KEY) private readonly db: DataSourceOptions,
    private readonly systemConfig: SystemConfigService
  ) {}

  /** 当前连接参数（配置层已按 env 解析，这里只做类型收窄） */
  private get conn(): MySqlConn {
    return this.db as unknown as MySqlConn
  }

  /** 备份目录：sql/backups（不进 git，见 .gitignore） */
  private backupDir(): string {
    const dir = join(process.cwd(), 'sql', 'backups')
    mkdirSync(dir, { recursive: true })
    return dir
  }

  /** 立即执行一次备份（手动触发与定时任务共用） */
  async backupNow(): Promise<BackupResult> {
    const startedAt = Date.now()
    if (!existsSync(this.mysqldumpPath)) {
      throw new Error(`找不到 mysqldump：${this.mysqldumpPath}，请用 MYSQLDUMP_PATH 指定`)
    }
    const now = new Date()
    const stamp = `${now.toLocaleString('sv-SE', { hour12: false }).replace(' ', '_').replace(/:/g, '')}_${String(now.getMilliseconds()).padStart(3, '0')}`
    const file = join(this.backupDir(), `concise_server_full_${stamp}.sql`)

    await this.dump(file)
    const sizeMb = Number((statSync(file).size / 1024 / 1024).toFixed(2))
    this.logger.log(`备份完成：${basename(file)}（${sizeMb} MB）`)

    const shouldVerify = await this.systemConfig.getBoolean('ops.backup.verify', true)
    const tables = shouldVerify ? await this.verify(file) : null
    const keepCount = await this.systemConfig.getNumber('ops.backup.keepCount', 7)
    const pruned = this.prune(keepCount, file)

    return {
      file: basename(file),
      sizeMb,
      createdAt: new Date().toISOString(),
      tables,
      verified: tables !== null,
      pruned,
      durationMs: Date.now() - startedAt
    }
  }

  /** 列出已有备份（新→旧） */
  list(): BackupFileInfo[] {
    const dir = this.backupDir()
    return readdirSync(dir)
      .filter(name => name.endsWith('.sql'))
      .map(name => {
        const full = join(dir, name)
        const stat = statSync(full)
        return { file: name, sizeMb: Number((stat.size / 1024 / 1024).toFixed(2)), createdAt: stat.mtime.toISOString() }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /** 导出到指定文件 */
  private async dump(file: string): Promise<void> {
    const args = [
      `--host=${this.conn.host}`,
      `--port=${String(this.conn.port)}`,
      `--user=${this.conn.username}`,
      '--default-character-set=utf8mb4',
      '--single-transaction',
      '--quick',
      '--no-tablespaces',
      '--set-gtid-purged=OFF',
      '--routines',
      '--events',
      '--triggers',
      '--hex-blob',
      `--result-file=${file}`,
      String(this.conn.database)
    ]
    const { code, stderr } = await this.run(this.mysqldumpPath, args)
    if (code !== 0) {
      // 导出失败时删掉半截文件，避免「看起来有备份其实打不开」
      if (existsSync(file)) unlinkSync(file)
      throw new Error(`mysqldump 退出码 ${code}：${stderr.replace(/^.*Using a password.*$/gm, '').trim()}`)
    }
  }

  /**
   * 导入校验：建临时库 → 导入 → 比对表数 → 删库
   * 表数对不上说明备份不完整（或源库在导出期间被 DDL 改了），直接抛错，让人知道要重跑。
   */
  private async verify(file: string): Promise<number> {
    const tmpDb = `concise_verify_${Date.now()}`
    const source = String(this.conn.database)
    const common = [`--host=${this.conn.host}`, `--port=${String(this.conn.port)}`, `--user=${this.conn.username}`, '--default-character-set=utf8mb4']

    await this.run(this.mysqlPath, [...common, '-e', `DROP DATABASE IF EXISTS \`${tmpDb}\`; CREATE DATABASE \`${tmpDb}\` COLLATE utf8mb4_unicode_ci;`])
    const sourceTables = await this.countTables(source, common)
    const imported = await this.run(this.mysqlPath, [...common, tmpDb], { inputFile: file })
    if (imported.code !== 0) {
      await this.dropDb(tmpDb, common)
      throw new Error(`备份文件导入临时库失败（退出码 ${imported.code}）：${imported.stderr.slice(0, 300)}`)
    }
    const importedTables = await this.countTables(tmpDb, common)
    await this.dropDb(tmpDb, common)
    if (importedTables !== sourceTables) {
      throw new Error(`备份校验失败：源库 ${sourceTables} 张表，导入后 ${importedTables} 张表`)
    }
    this.logger.log(`备份校验通过：${importedTables} 张表`)
    return importedTables
  }

  private async countTables(database: string, common: string[]): Promise<number> {
    const { stdout } = await this.run(this.mysqlPath, [
      ...common,
      '-N',
      '-e',
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${database}'`
    ])
    return Number(stdout.trim()) || 0
  }

  private async dropDb(database: string, common: string[]): Promise<void> {
    await this.run(this.mysqlPath, [...common, '-e', `DROP DATABASE IF EXISTS \`${database}\``])
  }

  /** 保留最近 keepCount 份（当前这份永远保留），返回删掉的数量 */
  private prune(keepCount: number, currentFile: string): number {
    const keep = Math.max(keepCount, 1)
    const files = this.list()
    const removeList = files.filter(item => item.file !== basename(currentFile)).slice(Math.max(keep - 1, 0))
    for (const item of removeList) {
      try {
        unlinkSync(join(this.backupDir(), item.file))
        this.logger.log(`清理旧备份：${item.file}`)
      } catch (error) {
        this.logger.warn(`清理旧备份失败 ${item.file}：${String(error)}`)
      }
    }
    return removeList.length
  }

  /** 跑一个外部命令，收集 stdout/stderr（不抛错，由调用方看 code） */
  private run(command: string, args: string[], options: { inputFile?: string } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise(resolve => {
      const child = spawn(command, args, {
        env: { ...process.env, MYSQL_PWD: String(this.conn.password ?? '') },
        stdio: [options.inputFile ? 'pipe' : 'ignore', 'pipe', 'pipe']
      })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', chunk => (stdout += String(chunk)))
      child.stderr?.on('data', chunk => (stderr += String(chunk)))
      if (options.inputFile && child.stdin) {
        // 用 shell 重定向更省内存，但跨平台不稳定；这里用流式管道（百 MB 级别也够用）
        createReadStream(options.inputFile).pipe(child.stdin)
      }
      child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }))
      child.on('error', error => resolve({ code: 1, stdout, stderr: `${stderr}${String(error)}` }))
    })
  }
}
