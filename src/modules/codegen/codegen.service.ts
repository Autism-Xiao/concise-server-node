import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

import { HttpStatus, Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'

import { BizErrorCode } from '../../common/enums/biz-error-code.enum'
import { BizException } from '../../common/exceptions/biz.exception'
import { CODEGEN_FIELD_TYPES, type GenerateCodegenDto, type PreviewCodegenDto } from './dto/codegen.dto'

/** 生成脚本的单次执行上限：脚本只做模板字符串拼接与写盘，正常 1s 内完成 */
const RUN_TIMEOUT_MS = 60_000
/** 预览时单个文件回传上限，防止误把大文件塞进响应 */
const MAX_PREVIEW_BYTES = 256 * 1024

/** 直接落库不需要暴露给业务的系统列（反查已有表时过滤） */
const SYSTEM_COLUMNS = new Set(['id', 'tenant_id', 'create_by', 'update_by', 'del_flag', 'created_at', 'updated_at'])

/** 菜单可选的 lucide 图标（与前端 page-registry 的常用图标对齐，避免选中后渲染不出） */
const MENU_ICONS = [
  { value: 'Briefcase', label: '公文包' },
  { value: 'Users', label: '用户' },
  { value: 'Box', label: '盒子' },
  { value: 'Truck', label: '货车' },
  { value: 'Tag', label: '标签' },
  { value: 'FileText', label: '文档' },
  { value: 'Database', label: '数据库' },
  { value: 'CalendarDays', label: '日历' },
  { value: 'Building2', label: '楼宇' },
  { value: 'ScrollText', label: '清单' }
]

interface RunResult {
  log: string
  manifest?: {
    module: string
    label: string
    table: string
    menuId: string
    created: string[]
    skipped: string[]
    overwritten?: string[]
    backupDir?: string
    addedColumns?: string[]
  }
}

export interface CodegenFile {
  /** 仓库作用域：server = 后端，admin = 前端管理后台 */
  scope: 'server' | 'admin'
  /** 相对所属仓库根目录的 posix 路径，前端直接展示 */
  path: string
  language: string
  bytes: number
  lines: number
  truncated: boolean
  content: string
}

export interface CodegenPreviewResult {
  module: string
  label: string
  table: string
  menuId: string
  files: CodegenFile[]
  /** 生成后会改变的注册点（app.module / 路由 / page-registry / i18n），预览阶段只提示不改 */
  touched: string[]
  warnings: string[]
  log: string
}

export interface CodegenGenerateResult {
  module: string
  label: string
  table: string
  menuId: string
  /** 本次写入的文件（新增 + 被覆盖的） */
  created: string[]
  skipped: string[]
  /** 被覆盖的已有文件（均已备份到 backupDir） */
  overwritten: string[]
  /** 覆盖模式的备份目录（相对后端仓库根），没有覆盖时为 null */
  backupDir: string | null
  /** 生成的迁移会补哪些缺失列（表已存在时才有） */
  addedColumns: string[]
  /** 本次没有做的事（表结构不动、全部文件已最新等），前端直接列出来 */
  warnings: string[]
  nextSteps: string[]
  log: string
}

export interface CodegenTableInfo {
  name: string
  comment: string
  columns: number
  /** 已存在同名模块目录（生成会被拒绝，除非 force） */
  hasModule: boolean
}

@Injectable()
export class CodegenService {
  private readonly logger = new Logger(CodegenService.name)

  /** 后端仓库根目录：从当前文件向上找到含 scripts/gen-module.cjs 的目录，兼容 dist 与 ts-node */
  private readonly serverRoot = (() => {
    let dir = __dirname
    for (let i = 0; i < 6; i++) {
      if (existsSync(path.join(dir, 'scripts', 'gen-module.cjs'))) return dir
      dir = path.dirname(dir)
    }
    return process.cwd()
  })()

  private readonly adminRoot = process.env.ADMIN_PORTAL_DIR ?? path.resolve(this.serverRoot, '../concise-admin')

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** 页面初始化数据：字段类型 / 图标 / 菜单父节点 / 可反查的表 / 开关状态 */
  async meta() {
    const parents = await this.dataSource.query(
      `SELECT id, name, url FROM sys_permission WHERE menu_type = 0 AND del_flag = 0 AND (parent_id IS NULL OR parent_id = '') ORDER BY sort_no ASC`
    )
    return {
      enabled: this.isEnabled(),
      production: process.env.NODE_ENV === 'production',
      roots: {
        server: this.serverRoot,
        admin: this.adminRoot,
        adminReady: existsSync(this.adminRoot)
      },
      types: [
        { value: 'string', label: '单行文本', hint: 'VARCHAR(128)' },
        { value: 'text', label: '多行文本', hint: 'TEXT' },
        { value: 'int', label: '整数', hint: 'INT' },
        { value: 'bigint', label: '长整数', hint: 'BIGINT' },
        { value: 'tinyint', label: '小整数', hint: 'TINYINT' },
        { value: 'decimal', label: '金额/小数', hint: 'DECIMAL(14,2)' },
        { value: 'datetime', label: '日期时间', hint: 'DATETIME' },
        { value: 'bool', label: '开关', hint: 'TINYINT(1)' },
        { value: 'enum', label: '枚举', hint: 'TINYINT + 标签映射' }
      ],
      icons: MENU_ICONS,
      parents: (parents as Array<{ id: string; name: string; url: string | null }>).map(row => ({
        value: row.id,
        label: row.name
      })),
      fieldTypes: CODEGEN_FIELD_TYPES
    }
  }

  /** 预览：跑一遍生成器但写进临时目录，读完内容即丢弃，真正零落盘 */
  async preview(dto: PreviewCodegenDto): Promise<CodegenPreviewResult> {
    this.assertEnabled()
    const existingColumns = await this.tableColumns(dto.table ?? dto.module)
    const stage = mkdtempSync(path.join(tmpdir(), 'codegen-preview-'))
    try {
      const specFile = path.join(stage, 'spec.json')
      writeFileSync(specFile, JSON.stringify(this.toSpec(dto, existingColumns), null, 2))
      const outDir = path.join(stage, 'out')
      // 表已存在时脚本会产出「补缺失列」的迁移，正好让人在预览里先看清要 ALTER 什么
      const cliArgs = ['--spec', specFile, '--out', outDir, '--no-register', '--json']
      const { log, manifest } = await this.run(cliArgs, '预览')
      const files = this.collectStaged(outDir)
      return {
        module: manifest?.module ?? dto.module,
        label: manifest?.label ?? dto.label,
        table: manifest?.table ?? dto.table ?? dto.module,
        menuId: manifest?.menuId ?? `menu_${dto.module}`,
        files,
        touched: this.touchedRegistrations(dto.module),
        warnings: this.warnings(dto, existingColumns),
        log
      }
    } finally {
      rmSync(stage, { recursive: true, force: true })
    }
  }

  /** 生成：真写盘 + 自动注册（app.module / 前端路由 / page-registry / i18n） */
  async generate(dto: GenerateCodegenDto): Promise<CodegenGenerateResult> {
    this.assertEnabled()
    const moduleDir = path.join(this.serverRoot, 'src', 'modules', dto.module)
    if (existsSync(moduleDir) && !dto.force) {
      throw new BizException(BizErrorCode.CODEGEN_MODULE_EXISTS, `模块目录 src/modules/${dto.module} 已存在，确认要追加生成请带上覆盖标记`)
    }
    const tableName = dto.table ?? dto.module
    // 表已存在只有两种来路：重新生成同一模块，或先手工建表再生成。
    // 把现有列名交给脚本，迁移里就会多出「补缺失列」的片段（CREATE TABLE IF NOT EXISTS 对旧表无效）。
    const existingColumns = await this.tableColumns(tableName)
    const tableExists = existingColumns.length > 0

    const specDir = mkdtempSync(path.join(tmpdir(), 'codegen-generate-'))
    const specFile = path.join(specDir, 'spec.json')
    try {
      writeFileSync(specFile, JSON.stringify(this.toSpec(dto, existingColumns), null, 2))
      const cliArgs = ['--spec', specFile, '--json']
      // force = 重新生成：同名文件覆盖（先备份）；非 force 走默认的「不覆盖」
      if (dto.force) cliArgs.push('--overwrite')
      const { log, manifest } = await this.run(cliArgs, '生成')

      const created = manifest?.created ?? []
      const skipped = manifest?.skipped ?? []
      const overwritten = manifest?.overwritten ?? []
      const addedColumns = manifest?.addedColumns ?? []
      const warnings: string[] = []
      if (tableExists && addedColumns.length === 0) {
        warnings.push(`数据表 ${tableName} 已存在且字段都对得上：本次没有补列，表结构不变`)
      }
      if (created.length === 0 && skipped.length > 0) {
        warnings.push('所有文件都已是最新，本次没有写入任何文件')
      }
      this.logger.log(
        `代码生成完成：${dto.module}（写入 ${created.length} 个${overwritten.length > 0 ? `，其中覆盖 ${overwritten.length} 个` : ''}，跳过 ${skipped.length} 个${
          addedColumns.length > 0 ? `，补列 ${addedColumns.length} 个` : ''
        }）`
      )
      return {
        module: manifest?.module ?? dto.module,
        label: manifest?.label ?? dto.label,
        table: manifest?.table ?? tableName,
        menuId: manifest?.menuId ?? `menu_${dto.module}`,
        created,
        skipped,
        overwritten,
        backupDir: manifest?.backupDir ? path.relative(this.serverRoot, manifest.backupDir) : null,
        addedColumns,
        warnings,
        nextSteps: this.nextSteps({ wrote: created.length > 0, tableExists, addedColumns }),
        log
      }
    } finally {
      rmSync(specDir, { recursive: true, force: true })
    }
  }

  /** 生成后的下一步：按本次到底做了什么给，避免让人跑一堆空命令 */
  private nextSteps(options: { wrote: boolean; tableExists: boolean; addedColumns: string[] }): string[] {
    const { wrote, tableExists, addedColumns } = options
    if (!wrote) {
      return ['本次没有写入任何文件，无需 build / 重启；要调整请改字段后重新生成，或直接改代码']
    }
    const steps: string[] = ['执行 npm run build 重新编译（新模块已自动注册进 app.module.ts）']
    if (!tableExists) steps.push('执行 npm run migration:run 建表并写入菜单节点')
    else if (addedColumns.length > 0) steps.push(`执行 npm run migration:run 补齐 ${addedColumns.join('、')} 等列（只加列，不改旧列）`)
    steps.push('重启后端进程（node scripts/serve.mjs）')
    if (!tableExists || addedColumns.length > 0) {
      steps.push('平台管理员执行 POST /v1/tenants/provision-all，让各租户角色模板拿到新菜单')
    }
    steps.push('前端 dev 会自动生成路由，刷新后侧边栏即可看到新菜单')
    return steps
  }

  /** 可反查的已有表：排除系统表与迁移表，标出已存在同名模块的（用于「从数据库表导入」） */
  async tables(): Promise<CodegenTableInfo[]> {
    const rows: Array<{ TABLE_NAME: string; TABLE_COMMENT: string | null; COLUMNS: number | string }> = await this.dataSource.query(
      `SELECT t.TABLE_NAME, t.TABLE_COMMENT,
              (SELECT COUNT(*) FROM information_schema.COLUMNS c
                WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME) AS COLUMNS
         FROM information_schema.TABLES t
        WHERE t.TABLE_SCHEMA = DATABASE()
          AND t.TABLE_TYPE = 'BASE TABLE'
          AND t.TABLE_NAME NOT LIKE 'sys\\_%'
          AND t.TABLE_NAME NOT LIKE 'qrtz\\_%'
          AND t.TABLE_NAME <> 'migrations'
        ORDER BY t.TABLE_NAME ASC`
    )
    return rows.map(row => ({
      name: row.TABLE_NAME,
      comment: row.TABLE_COMMENT ?? '',
      columns: Number(row.COLUMNS ?? 0),
      hasModule: existsSync(path.join(this.serverRoot, 'src', 'modules', row.TABLE_NAME))
    }))
  }

  /** 从已有表反推字段定义：类型映射 + 注释 + 单列唯一索引，过滤系统列 */
  async introspect(table: string) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(table)) {
      throw new BizException(BizErrorCode.PARAM_INVALID, '表名不合法')
    }
    const exists = await this.tableExists(table)
    if (!exists) throw new BizException(BizErrorCode.NOT_FOUND, `数据表 ${table} 不存在`)

    const columns: Array<{
      COLUMN_NAME: string
      DATA_TYPE: string
      COLUMN_TYPE: string
      IS_NULLABLE: string
      COLUMN_DEFAULT: string | null
      COLUMN_COMMENT: string
    }> = await this.dataSource.query(
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION ASC`,
      [table]
    )
    const uniques: Array<{ COLUMN_NAME: string }> = await this.dataSource.query(
      `SELECT COLUMN_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'
        GROUP BY INDEX_NAME, COLUMN_NAME HAVING COUNT(*) = 1`,
      [table]
    )
    const uniqueColumns = new Set(uniques.map(row => row.COLUMN_NAME))

    const fields = columns
      .filter(column => !SYSTEM_COLUMNS.has(column.COLUMN_NAME))
      .map(column => ({
        name: column.COLUMN_NAME,
        type: this.mapColumnType(column.DATA_TYPE, column.COLUMN_TYPE),
        comment: column.COLUMN_COMMENT || column.COLUMN_NAME,
        required: column.IS_NULLABLE === 'NO' && column.COLUMN_DEFAULT === null,
        unique: uniqueColumns.has(column.COLUMN_NAME),
        query: false,
        search: false,
        default: column.COLUMN_DEFAULT ?? undefined
      }))
    const tableComment: Array<{ TABLE_COMMENT: string }> = await this.dataSource.query(
      `SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table]
    )
    return {
      table,
      label: tableComment[0]?.TABLE_COMMENT || table,
      fields
    }
  }

  // ==================== 内部实现 ====================

  private isEnabled(): boolean {
    const flag = (process.env.CODEGEN_ENABLED ?? '').trim().toLowerCase()
    if (flag) return ['1', 'true', 'on', 'yes'].includes(flag)
    return process.env.NODE_ENV !== 'production'
  }

  private assertEnabled() {
    if (this.isEnabled()) return
    throw new BizException(BizErrorCode.CODEGEN_DISABLED, '代码生成器已关闭（生产环境默认禁用，需要 CODEGEN_ENABLED=true 显式开启）', HttpStatus.FORBIDDEN)
  }

  private toSpec(dto: PreviewCodegenDto, existingColumns: string[] = []) {
    return {
      module: dto.module,
      label: dto.label,
      perms: dto.perms ?? dto.module,
      table: dto.table ?? dto.module,
      menuParent: dto.menuParent ?? 'menu_collab',
      sort: dto.sort ?? 50,
      icon: dto.icon ?? 'Briefcase',
      adminRoot: this.adminRoot,
      existingColumns,
      fields: dto.fields.map(field => ({
        name: field.name,
        type: field.type,
        comment: field.comment ?? field.name,
        required: !!field.required,
        unique: !!field.unique,
        query: !!field.query,
        search: !!field.search,
        default: field.default,
        enumValues: field.enumValues ?? []
      }))
    }
  }

  /** 预览阶段明确告知「生成时会改动哪些注册文件」，避免用户以为只有新文件 */
  private touchedRegistrations(module: string): string[] {
    const list = ['src/app.module.ts（import + imports 数组）']
    if (existsSync(this.adminRoot)) {
      list.push(
        `concise-admin/src/routes/_authenticated/system/${module}s.tsx（新增路由文件）`,
        'concise-admin/src/config/page-registry.ts（import + 登记）',
        'concise-admin/src/config/i18n.ts（nav.system 中英各一条）'
      )
    }
    return list
  }

  private warnings(dto: PreviewCodegenDto, existingColumns: string[]): string[] {
    const list: string[] = []
    const table = dto.table ?? dto.module
    const tableExists = existingColumns.length > 0
    if (existsSync(path.join(this.serverRoot, 'src', 'modules', dto.module))) {
      list.push(`后端已有 src/modules/${dto.module}：确认生成时同名文件会先备份到 .codegen-backup/ 再覆盖`)
    }
    if (tableExists) {
      const missing = dto.fields.filter(field => !existingColumns.includes(field.name)).map(field => field.name)
      list.push(
        missing.length > 0
          ? `数据表 ${table} 已存在：迁移只补缺失列（${missing.join('、')}），已有列的类型与默认值不会被修改`
          : `数据表 ${table} 已存在且字段都对得上：迁移里不会有 ALTER，表结构不变`
      )
    }
    if (!existsSync(this.adminRoot)) {
      list.push('未找到前端管理后台目录，只会生成后端产物（可用 ADMIN_PORTAL_DIR 指定）')
    }
    if (table.length > 48) list.push('表名较长，注意 MySQL 索引名长度限制')
    if (!dto.fields.some(field => field.search || field.query)) {
      list.push('没有任何字段勾选「查询/搜索」，生成的列表页只能翻页，无法按条件过滤')
    }
    if (!dto.fields.some(field => field.type === 'string')) {
      list.push('没有 string 类型字段，列表页首列与详情标题会退化用 id 展示')
    }
    return list
  }

  private async tableExists(table: string): Promise<boolean> {
    const rows: Array<{ c: number | string }> = await this.dataSource.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table]
    )
    return Number(rows[0]?.c ?? 0) > 0
  }

  /** 目标表现有列名（空数组 = 表不存在）；交给生成脚本判断迁移里要不要补列 */
  private async tableColumns(table: string): Promise<string[]> {
    const rows: Array<{ c: string }> = await this.dataSource.query(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [table]
    )
    return rows.map(row => row.c)
  }

  private mapColumnType(dataType: string, columnType: string): string {
    const type = dataType.toLowerCase()
    if (type === 'tinyint') return /tinyint\(1\)/.test(columnType.toLowerCase()) ? 'bool' : 'tinyint'
    if (['smallint', 'mediumint', 'int', 'integer'].includes(type)) return 'int'
    if (type === 'bigint') return 'bigint'
    if (['decimal', 'numeric', 'float', 'double'].includes(type)) return 'decimal'
    if (['date', 'datetime', 'timestamp'].includes(type)) return 'datetime'
    if (['text', 'mediumtext', 'longtext', 'json'].includes(type)) return 'text'
    return 'string'
  }

  /** 把暂存目录里的产物读回内存：<out>/server/** 与 <out>/admin/** */
  private collectStaged(outDir: string): CodegenFile[] {
    const files: CodegenFile[] = []
    const walk = (dir: string, scope: 'server' | 'admin', base: string) => {
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full, scope, base)
          continue
        }
        const stat = statSync(full)
        const raw = readFileSync(full, 'utf8')
        files.push({
          scope,
          path: path.relative(base, full).split(path.sep).join('/'),
          language: this.languageOf(entry.name),
          bytes: stat.size,
          lines: raw.split('\n').length,
          truncated: raw.length > MAX_PREVIEW_BYTES,
          content: raw.length > MAX_PREVIEW_BYTES ? `${raw.slice(0, MAX_PREVIEW_BYTES)}\n/* 内容超长已截断 */` : raw
        })
      }
    }
    walk(path.join(outDir, 'server'), 'server', path.join(outDir, 'server'))
    walk(path.join(outDir, 'admin'), 'admin', path.join(outDir, 'admin'))
    return files.sort((a, b) => (a.scope === b.scope ? a.path.localeCompare(b.path) : a.scope === 'server' ? -1 : 1))
  }

  private languageOf(fileName: string): string {
    if (fileName.endsWith('.ts') || fileName.endsWith('.tsx')) return 'typescript'
    if (fileName.endsWith('.json')) return 'json'
    return 'text'
  }

  private run(extraArgs: string[], label: string): Promise<RunResult> {
    const script = path.join(this.serverRoot, 'scripts', 'gen-module.cjs')
    if (!existsSync(script)) {
      throw new BizException(BizErrorCode.CODEGEN_FAILED, `找不到生成脚本 ${script}`)
    }
    return new Promise<RunResult>((resolve, reject) => {
      const child = spawn(process.execPath, [script, ...extraArgs], { cwd: this.serverRoot, windowsHide: true })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new BizException(BizErrorCode.CODEGEN_FAILED, `${label}超时（超过 ${RUN_TIMEOUT_MS / 1000}s）`))
      }, RUN_TIMEOUT_MS)
      child.stdout.on('data', chunk => {
        stdout += String(chunk)
      })
      child.stderr.on('data', chunk => {
        stderr += String(chunk)
      })
      child.on('error', error => {
        clearTimeout(timer)
        reject(new BizException(BizErrorCode.CODEGEN_FAILED, `生成脚本启动失败：${error.message}`))
      })
      child.on('close', code => {
        clearTimeout(timer)
        const marker = stdout.split(/\r?\n/).find(line => line.startsWith('__CODEGEN__'))
        let manifest: RunResult['manifest']
        if (marker) {
          try {
            manifest = JSON.parse(marker.slice('__CODEGEN__'.length)) as RunResult['manifest']
          } catch {
            manifest = undefined
          }
        }
        const log = stdout
          .split(/\r?\n/)
          .filter(line => !line.startsWith('__CODEGEN__'))
          .join('\n')
          .trim()
        if (code !== 0) {
          const message = stderr.trim().split(/\r?\n/)[0] || `${label}失败（退出码 ${code}）`
          reject(new BizException(BizErrorCode.CODEGEN_FAILED, message))
          return
        }
        resolve({ log, manifest })
      })
    })
  }
}
