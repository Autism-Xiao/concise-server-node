#!/usr/bin/env node
/**
 * 代码生成器：一份模块定义 → 后端五件套 + 迁移 + 前端页面 + 自动注册
 *
 * 用法：
 *   node scripts/gen-module.cjs \
 *     --module customer \
 *     --label 客户 \
 *     --perms customer \
 *     --fields "name:string:客户名称:r,s, contact:string:联系人, phone:string:电话:u, level:tinyint:级别:default=1, remark:text:备注"
 *
 *   字段格式：名称:类型:中文备注[:选项，逗号分隔]
 *     类型：string / text / int / bigint / tinyint / decimal / datetime / bool / enum
 *     选项：r=必填  u=唯一  q=列表查询过滤  s=keyword 模糊搜索
 *           default=N=默认值  e=v:标签|v:标签（enum 专用，值与标签用冒号、项用竖线，标签里别用冒号）
 *
 * 产物：
 *   后端 src/modules/<module>/   entity + dto + service + v1.controller + module
 *        src/migrations/<ts>-Gen<Module>.ts（含菜单节点，带 scope 列）
 *   前端 <admin>/src/features/<module>/  api.ts + index.tsx（DataTable 规约）
 *                                       + components/<module>-form-drawer.tsx（AppDrawer 规约）
 *   自动注册：app.module.ts / 前端路由文件 / page-registry / i18n（--no-register 跳过）
 *
 * 生成后仍需手动：
 *   1. npx typeorm migration:run（建表 + 菜单节点）
 *   2. 租户级菜单想让各租户角色可见 → POST /v1/tenants/provision-all
 *
 * 所有产物遵循项目既定规约：统一响应走控制层、{ code, message, result, success, timestamp }、
 * SnakeNamingStrategy（驼峰属性自动映射下划线列）、租户作用域、唯一键先查重（含软删占用）
 * + 捕获 ER_DUP_ENTRY、软删 del_flag、@Perms 按钮权限、前端 DataTable + AppDrawer。
 */
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const NO_REGISTER = args.includes('--no-register')
/** --no-migration：目标表已建（重复生成 / 先建表后生成），不再产迁移，避免 migrations 表出现同表重复记录 */
const NO_MIGRATION = args.includes('--no-migration')
/** --overwrite：同名文件先备份到 .codegen-backup/<时间戳>/ 再覆盖（重新生成用，默认绝不覆盖） */
const OVERWRITE = args.includes('--overwrite')
const backupStamp = new Date().toISOString().replace(/[:.]/g, '-')

function argOf(name, fallback) {
  const key = name.startsWith('--') ? name : `--${name}`
  const index = args.indexOf(key)
  if (index === -1 || !args[index + 1]) return fallback
  return args[index + 1]
}
function usageAndExit() {
  console.log('用法见文件头注释。必填：--module --label --perms --fields')
  process.exit(1)
}

/**
 * --spec <file.json>：结构化定义（页面表单 → JSON 直接落盘，避免中文/逗号破坏 DSL 解析）
 *   { module, label, perms?, table?, menuParent?, sort?, icon?,
 *     existingColumns?: string[]（目标表现有列名，用于生成补列的 ALTER）,
 *     fields: [{ name, type, comment, required, unique, query, search, default, enumValues: [{value,label}] }] }
 * --out <dir>：把所有产物写进暂存目录（server/ 与 admin/ 两棵子树），用于「不落盘的预览」
 * --json：结束时多打一行 __CODEGEN__{...} 机器可读清单（页面接口解析）
 * --no-migration：不产迁移文件（目标表已存在时用，避免 migrations 表出现同表重复记录）
 * --overwrite：同名文件先备份到 .codegen-backup/<时间戳>/ 再覆盖
 */
const specPath = argOf('--spec')
const spec = specPath ? JSON.parse(fs.readFileSync(path.resolve(specPath), 'utf8')) : {}

const moduleSnake = spec.module ?? argOf('--module')
const label = spec.label ?? argOf('--label', moduleSnake)
if (!moduleSnake || !label) usageAndExit()
if (!/^[a-z][a-z0-9_]*$/.test(moduleSnake)) {
  console.error(`--module 须为小写蛇形（如 customer / biz_order），收到：${moduleSnake}`)
  process.exit(1)
}
/** 目标表现有列名：非空才说明表已存在，迁移里才会出现补列片段 */
const existingColumns = Array.isArray(spec.existingColumns) ? spec.existingColumns.map(String) : []
const moduleCamel = moduleSnake.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
const ModulePascal = moduleCamel[0].toUpperCase() + moduleCamel.slice(1)
const permsPrefix = spec.perms ?? argOf('--perms', moduleSnake)
const table = spec.table ?? argOf('--table', moduleSnake)
const menuParent = spec.menuParent ?? argOf('--menu-parent', 'menu_collab')
const menuSort = Number(spec.sort ?? argOf('--sort', '50'))
const feIcon = spec.icon ?? argOf('--icon', 'Briefcase')
const adminRoot = spec.adminRoot ?? argOf('--admin', path.resolve(process.cwd(), '../concise-admin'))
const serverRoot = process.cwd()
const OUT_ROOT = argOf('--out')
const JSON_OUT = args.includes('--json')

const TYPE_MAP = {
  string: { ts: 'string', mysql: 'VARCHAR(128)', dto: 'IsString', fe: 'input' },
  text: { ts: 'string', mysql: 'TEXT', dto: 'IsString', fe: 'textarea' },
  int: { ts: 'number', mysql: 'INT', dto: 'IsInt', fe: 'number' },
  bigint: { ts: 'number', mysql: 'BIGINT', dto: 'IsInt', fe: 'number' },
  tinyint: { ts: 'number', mysql: 'TINYINT', dto: 'IsInt', fe: 'number' },
  decimal: { ts: 'number', mysql: 'DECIMAL(14,2)', dto: 'IsNumber', fe: 'number' },
  datetime: { ts: 'string', mysql: 'DATETIME', dto: 'IsISO8601', fe: 'datetime' },
  bool: { ts: 'boolean', mysql: 'TINYINT(1)', dto: 'IsBoolean', fe: 'switch' },
  enum: { ts: 'number', mysql: 'TINYINT', dto: 'IsInt', fe: 'enum' }
}
const NUMERIC_TYPES = ['int', 'bigint', 'tinyint', 'decimal', 'enum']

/** 统一字段校验：DSL 与 --spec JSON 都走这里，保证两条入口行为一致 */
function normalizeField(raw, rawText) {
  const name = raw.name
  const type = raw.type
  const text = rawText ?? `${name}:${type}`
  if (!name || !TYPE_MAP[type]) {
    console.error(`字段「${text}」不合法（类型须为 ${Object.keys(TYPE_MAP).join('/')}）`)
    process.exit(2)
  }
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    console.error(`字段名「${name}」须为小写蛇形`)
    process.exit(2)
  }
  if ((raw.comment ?? '').length > 64) {
    console.error(`字段「${name}」中文备注过长（≤64 字）`)
    process.exit(2)
  }
  const field = {
    name,
    type,
    comment: raw.comment || name,
    required: !!raw.required,
    unique: !!raw.unique,
    query: !!raw.query,
    search: !!raw.search,
    default: raw.default === undefined || raw.default === null || raw.default === '' ? undefined : String(raw.default),
    enumValues: []
  }
  if (type === 'enum') {
    const list = Array.isArray(raw.enumValues) ? raw.enumValues : []
    if (list.length === 0) {
      console.error(`enum 字段「${name}」缺少枚举值（如 1:普通|2:VIP）`)
      process.exit(2)
    }
    field.enumValues = list.map(item => {
      if (!Number.isFinite(Number(item.value)) || !item.label) {
        console.error(`enum 字段「${name}」选项「${JSON.stringify(item)}」不合法，应为 值:标签`)
        process.exit(2)
      }
      return { value: Number(item.value), label: String(item.label) }
    })
    if (field.default !== undefined && !field.enumValues.some(item => item.value === Number(field.default))) {
      console.error(`enum 字段「${name}」默认值 ${field.default} 不在枚举值里`)
      process.exit(2)
    }
  }
  if (type === 'bool' && field.default !== undefined && !['0', '1'].includes(field.default)) {
    console.error(`bool 字段「${name}」默认值只能是 0/1`)
    process.exit(2)
  }
  return field
}

/** DSL：名称:类型:中文备注[:选项，逗号分隔] —— 兼容命令行老用法
 *  字段之间用逗号分隔，但选项也用逗号（r,s）→ 不含冒号的分段并回上一个字段，
 *  这样 "name:string:名称:r,s, contact:string:联系人" 与 "name:string:名称:rs" 都成立。 */
function parseFieldsDsl(fieldsArg) {
  const merged = []
  for (const segment of fieldsArg.split(',')) {
    const text = segment.trim()
    if (!text) continue
    if (merged.length === 0 || text.includes(':')) merged.push(text)
    else merged[merged.length - 1] += `,${text}`
  }
  return merged
    .map(raw => {
      // 选项可能含冒号（enum 的 e=1:启用），把第 3 个冒号之后的全部并回选项
      const parts = raw.split(':')
      const [name, type, comment] = parts
      const options = parts.slice(3).join(':') ?? ''
      const defaultMatch = options.match(/default=([^,]+)/)
      const enumMatch = options.match(/e=([^,]+)/)
      const flagStr = options.replace(/default=[^,]+/g, '').replace(/e=[^,]+/g, '').replace(/[,\s]/g, '')
      const enumValues = enumMatch
        ? enumMatch[1].split('|').map(pair => {
            const [value, enumLabel] = pair.split(':')
            if (value === undefined || enumLabel === undefined) {
              console.error(`enum 字段「${name}」选项「${pair}」不合法，应为 值:标签`)
              process.exit(2)
            }
            return { value: Number(value), label: enumLabel }
          })
        : []
      return normalizeField(
        {
          name,
          type,
          comment,
          required: flagStr.includes('r'),
          unique: flagStr.includes('u'),
          query: flagStr.includes('q'),
          search: flagStr.includes('s'),
          default: defaultMatch?.[1],
          enumValues
        },
        raw
      )
    })
}

const specFields = Array.isArray(spec.fields) && spec.fields.length > 0 ? spec.fields : null
const fieldsArg = argOf('--fields')
if (!specFields && !fieldsArg) usageAndExit()
if (specFields && specFields.length > 40) {
  console.error('字段数量超过 40 个，请拆表（生成器不适合超宽表）')
  process.exit(2)
}
const parsedFields = specFields ? specFields.map(field => normalizeField(field)) : parseFieldsDsl(fieldsArg)

const pascal = name => name.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())
const tsProp = name => pascal(name)[0].toLowerCase() + pascal(name).slice(1)
const writeCount = { ok: 0, skip: 0 }
const written = []
const skippedFiles = []
const overwrittenFiles = []
/**
 * 预览专用：每个产物在【真实仓库】里的状态（server:相对路径 / admin:相对路径 -> new|skip|overwrite）。
 * --out 暂存时不看真实仓库会导致「预览说全部新建，实际生成却跳过/覆盖」，这里把真实状态带回预览页。
 */
const stagedFileStatus = {}
function statusKey(file) {
  if (file.startsWith(serverRoot + path.sep)) return `server:${path.relative(serverRoot, file).split(path.sep).join('/')}`
  if (file.startsWith(adminRoot + path.sep)) return `admin:${path.relative(adminRoot, file).split(path.sep).join('/')}`
  return `other:${path.basename(file)}`
}
/** 覆盖模式的备份根目录（只在真的覆盖了文件时才存在） */
const backupRoot = path.join(serverRoot, '.codegen-backup', backupStamp)
/** 对外展示的相对路径：后端仓库内直接相对 serverRoot，前端仓库加 concise-admin/ 前缀 */
function displayRel(file) {
  if (file.startsWith(serverRoot + path.sep)) return path.relative(serverRoot, file)
  if (file.startsWith(adminRoot + path.sep)) return path.join('concise-admin', path.relative(adminRoot, file))
  return path.relative(serverRoot, file)
}
/** --out 暂存模式：把两个仓库的产物各自映射到 <out>/server 与 <out>/admin 子树 */
function mapOut(file) {
  if (!OUT_ROOT) return file
  if (file.startsWith(serverRoot + path.sep)) return path.join(OUT_ROOT, 'server', path.relative(serverRoot, file))
  if (file.startsWith(adminRoot + path.sep)) return path.join(OUT_ROOT, 'admin', path.relative(adminRoot, file))
  return path.join(OUT_ROOT, 'other', path.basename(file))
}
function writeFile(file, content) {
  const rel = displayRel(file)
  if (DRY_RUN) {
    console.log(`[dry-run] 将生成: ${rel}`)
    written.push(rel)
    return
  }
  const target = mapOut(file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
  writeCount.ok++
  written.push(rel)
  console.log(`生成: ${rel}`)
}
function writeIfAbsent(file, content) {
  const rel = displayRel(file)
  // --out 暂存模式（预览）：内容照常写进暂存目录（预览要看到完整产物），
  // 但记录真实仓库里同名文件的状态，回传给页面标注「将新建 / 将跳过 / 将覆盖」。
  if (OUT_ROOT) {
    stagedFileStatus[statusKey(file)] = fs.existsSync(file) ? (OVERWRITE ? 'overwrite' : 'skip') : 'new'
    writeFile(file, content)
    return
  }
  if (fs.existsSync(file)) {
    const rel = displayRel(file)
    if (!OVERWRITE) {
      console.log(`跳过（已存在）: ${rel}`)
      writeCount.skip++
      skippedFiles.push(rel)
      return
    }
    // 覆盖：旧内容先落备份（路径分隔符压平成 __，避免子目录重名冲突）
    const backupFile = path.join(backupRoot, rel.replace(/[\\/]/g, '__'))
    fs.mkdirSync(path.dirname(backupFile), { recursive: true })
    fs.copyFileSync(file, backupFile)
    overwrittenFiles.push(rel)
    console.log(`覆盖（旧文件已备份）: ${rel}`)
    writeFile(file, content)
    return
  }
  writeFile(file, content)
}

/** 在 content 里最后一个匹配 regex 的行后插入 snippet；找不到返回 false */
function injectAfterLast(content, regex, snippet, labelForLog) {
  if (content.split('\n').some(line => line.trim() === snippet.trim())) {
    console.log(`注册跳过（已存在）: ${labelForLog}`)
    return content
  }
  const lines = content.split('\n')
  let lastIdx = -1
  lines.forEach((line, i) => {
    if (regex.test(line)) lastIdx = i
  })
  if (lastIdx === -1) {
    console.warn(`⚠️ 注册失败（找不到锚点，请手工处理）: ${labelForLog}`)
    return content
  }
  lines.splice(lastIdx + 1, 0, snippet)
  console.log(`注册: ${labelForLog}`)
  return lines.join('\n')
}

// ==================== 后端 ====================

// ---------- entity ----------
const entityColumns = parsedFields
  .map(field => {
    const typeMap = TYPE_MAP[field.type]
    const nullable = field.required ? '' : ', nullable: true'
    const isStringDefault = ['string', 'text'].includes(field.type)
    const defaultValue = field.default !== undefined ? `, default: ${isStringDefault ? `'${field.default}'` : field.default}` : ''
    const columnType = isStringDefault
      ? `{ type: 'varchar', length: 128${nullable}${defaultValue} }`
      : `{ type: '${['bool', 'enum'].includes(field.type) ? 'tinyint' : field.type}'${nullable}${defaultValue} }`
    const uniqueNote = field.unique ? `，唯一键 (${field.comment} 按租户唯一)` : ''
    return `  @ApiPropertyOptional({ description: '${field.comment}${uniqueNote}' })
  @Column(${columnType})
  ${tsProp(field.name)}?: ${typeMap.ts} | null`
  })
  .join('\n\n')

const entityFile = path.join(serverRoot, `src/modules/${moduleSnake}/entities/${moduleSnake}.entity.ts`)
writeIfAbsent(
  entityFile,
  `import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

/** ${label}（生成器产物，字段调整请连同迁移一起改） */
@Entity('${table}')
export class ${ModulePascal}Entity {
  @ApiProperty({ description: '${label} ID' })
  @PrimaryGeneratedColumn()
  id: number

  @ApiPropertyOptional({ description: '租户 ID（0=平台共享）', example: 1 })
  @Column({ type: 'int', default: 1, comment: '租户ID(0=平台共享)' })
  tenantId?: number

${entityColumns}

  @ApiPropertyOptional({ description: '创建人（用户名/账号）', nullable: true })
  @Column({ type: 'varchar', length: 32, nullable: true, comment: '创建人' })
  createBy?: string | null

  @ApiPropertyOptional({ description: '更新人', nullable: true })
  @Column({ type: 'varchar', length: 32, nullable: true, comment: '更新人' })
  updateBy?: string | null

  @ApiPropertyOptional({ description: '删除标记：0 正常 / 1 已删除' })
  @Column({ type: 'tinyint', default: 0, comment: '0正常 1已删除' })
  delFlag: number

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
  createdAt: Date

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at', comment: '更新时间' })
  updatedAt: Date
}
`
)

// ---------- DTO ----------
const usedValidators = new Set(['IsOptional'])
if (parsedFields.some(field => field.required)) usedValidators.add('IsNotEmpty')
for (const field of parsedFields) usedValidators.add(TYPE_MAP[field.type].dto)
if (parsedFields.some(field => NUMERIC_TYPES.includes(field.type))) usedValidators.add('Type')
if (parsedFields.some(field => field.type === 'enum')) usedValidators.add('IsIn')
if (parsedFields.some(field => field.unique)) usedValidators.add('MaxLength')
// Query DTO 的 keyword 恒用 @MaxLength(64)，与是否出现唯一字段无关
usedValidators.add('MaxLength')
const validatorImports = [...usedValidators].filter(name => name !== 'Type' && !name.startsWith('Api')).join(', ') || 'IsOptional'
const needsType = usedValidators.has('Type')
// ListDto 的 page/pageSize/sortBy/sortOrder 由 PagerDto 提供，这里不再重复声明。
// 注意列名前缀：dto 文件在 src/modules/<m>/dto/，PagerDto 在 src/common/dto/ → 相对路径 ../../../common/dto/pager.dto

const createDtoFields = parsedFields
  .map(field => {
    const typeMap = TYPE_MAP[field.type]
    const prop = `  @ApiProperty${field.required ? '' : 'Optional'}({ description: '${field.comment}'${field.required ? '' : ', nullable: true'} })`
    let validators = field.required ? `  @IsNotEmpty({ message: '${field.comment}不能为空' })` : '  @IsOptional()'
    validators += `\n  @${typeMap.dto}()`
    if (field.type === 'enum') validators += `\n  @IsIn([${field.enumValues.map(item => item.value).join(', ')}], { message: '${field.comment}取值不合法' })`
    if (field.unique) validators += `\n  @MaxLength(128, { message: '${field.comment}最长 128 位' })`
    if (NUMERIC_TYPES.includes(field.type)) validators += `\n  @Type(() => Number)`
    return `${prop}
${validators}
  ${tsProp(field.name)}${field.required ? '' : '?'}: ${typeMap.ts}`
  })
  .join('\n\n')

const updateDtoFields = parsedFields
  .map(field => {
    const typeMap = TYPE_MAP[field.type]
    const prop = `  @ApiPropertyOptional({ description: '${field.comment}', nullable: true })`
    let validators = '  @IsOptional()'
    validators += `\n  @${typeMap.dto}()`
    if (field.type === 'enum') validators += `\n  @IsIn([${field.enumValues.map(item => item.value).join(', ')}], { message: '${field.comment}取值不合法' })`
    if (NUMERIC_TYPES.includes(field.type)) validators += `\n  @Type(() => Number)`
    return `${prop}
${validators}
  ${tsProp(field.name)}?: ${typeMap.ts} | null`
  })
  .join('\n\n')

const listQueryFields = parsedFields
  .filter(field => field.query)
  .map(field => {
    const prop = `  @ApiPropertyOptional({ description: '按${field.comment}精确过滤' })`
    let validators = '  @IsOptional()'
    validators += `\n  @${TYPE_MAP[field.type].dto}()`
    if (NUMERIC_TYPES.includes(field.type)) validators += `\n  @Type(() => Number)`
    return `${prop}
${validators}
  ${tsProp(field.name)}?: ${TYPE_MAP[field.type].ts}`
  })
  .join('\n\n')

const dtoFile = path.join(serverRoot, `src/modules/${moduleSnake}/dto/${moduleSnake}.dto.ts`)
writeIfAbsent(
  dtoFile,
  `import { ${validatorImports} } from 'class-validator'
${needsType ? "import { Type } from 'class-transformer'\n" : ''}import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { PagerDto } from '../../../common/dto/pager.dto'

export class Create${ModulePascal}Dto {
${createDtoFields}
}

export class Update${ModulePascal}Dto {
${updateDtoFields}
}

/** 列表查询参数：分页/排序由 PagerDto 统一提供（page/pageSize/sortBy/sortOrder），这里只放业务过滤项 */
export class List${ModulePascal}Dto extends PagerDto {
  @ApiPropertyOptional({ description: '模糊搜索关键字' })
  @IsOptional()
  @MaxLength(64, { message: '关键字最长 64 位' })
  keyword?: string
${listQueryFields ? `\n\n${listQueryFields}` : ''}
}
`
)

// ---------- service ----------
// 注意：QueryBuilder 里 `alias.xxx` 用的是【实体属性名（驼峰）】，不是数据库列名（蛇形）。
// 早期版本直接拼 field.name，遇到 customer_name 这类下划线字段会 EntityPropertyNotFoundError，
// 且 assertAllUnique 里 record[field] 也取不到驼峰 DTO 属性 → 查重静默失效。
const searchConds = parsedFields
  .filter(field => field.search)
  .map(field => `      qb.andWhere('${moduleCamel}.${tsProp(field.name)} LIKE :keyword', { keyword: \`%\${query.keyword}%\` })`)
  .join('\n')
const queryConds = parsedFields
  .filter(field => field.query)
  .map(field => {
    const name = tsProp(field.name)
    return `    if (query.${name} !== undefined && query.${name} !== null) {
      qb.andWhere('${moduleCamel}.${name} = :${name}', { ${name}: query.${name} })
    }`
  })
  .join('\n')
const uniqueFields = parsedFields.filter(field => field.unique)
const uniquePropList = uniqueFields.map(field => `'${tsProp(field.name)}'`).join(', ')
const uniqueLabelMap = uniqueFields.map(field => `    ${tsProp(field.name)}: '${field.comment}'`).join(',\n') || '    // 无唯一字段'

/** 排序白名单：key 为前端列 id（实体属性名），value 为 QB 属性名；applySort 命中后补 id 兜底防翻页重复 */
const sortableEntries = parsedFields
  .filter(field => field.type !== 'text')
  .map(field => `  ${tsProp(field.name)}: '${tsProp(field.name)}'`)
const sortableBlock = `const ${ModulePascal}SORTABLE: Record<string, string> = {
${sortableEntries.length ? sortableEntries.join(',\n') + ',\n' : ''}  id: 'id'
}`

const serviceFile = path.join(serverRoot, `src/modules/${moduleSnake}/${moduleSnake}.service.ts`)
writeIfAbsent(
  serviceFile,
  `import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { isDuplicateEntryError } from '../../utils/db-error.util'
import { BaseService } from '../../helper/crud/base.service'
import { applySort, paginate, type Pagination } from '../../helper/paginate'
import { TenantContext } from '../../shared/tenant/tenant.context'
import { applyTenantScope } from '../../shared/tenant/tenant-scope.util'
import { Create${ModulePascal}Dto, List${ModulePascal}Dto, Update${ModulePascal}Dto } from './dto/${moduleSnake}.dto'
import { ${ModulePascal}Entity } from './entities/${moduleSnake}.entity'

${sortableBlock}

@Injectable()
export class ${ModulePascal}Service extends BaseService<${ModulePascal}Entity> {
  /** 唯一字段列名；查重必须含软删行（软删行仍占用数据库唯一键，不能过滤 del_flag） */
  private readonly uniqueFields: readonly string[] = [${uniquePropList}]

  private readonly uniqueLabels: Record<string, string> = {
${uniqueLabelMap}
  }

  constructor(
    @InjectRepository(${ModulePascal}Entity)
    repository: Repository<${ModulePascal}Entity>
  ) {
    super(repository, '${label}')
  }

  /** 唯一键查重：excludeId 供更新时排除自身；按租户作用域查（唯一键也是 (tenant_id, 字段)） */
  private async assertUnique(field: string, value: string | number, excludeId?: number): Promise<void> {
    const qb = this.repository.createQueryBuilder('t').where('t.' + field + ' = :value', { value })
    if (excludeId !== undefined) qb.andWhere('t.id != :excludeId', { excludeId })
    this.applyTenantToQuery(qb, 't')
    const exists = await qb.getOne()
    if (exists) throw new BadRequestException(\`\${this.uniqueLabels[field] ?? field}「\${value}」已存在\`)
  }

  private async assertAllUnique(dto: object, excludeId?: number): Promise<void> {
    const record = dto as Record<string, unknown>
    for (const field of this.uniqueFields) {
      const value = record[field]
      if (value !== undefined && value !== null && value !== '') {
        await this.assertUnique(field, value as string | number, excludeId)
      }
    }
  }

  /** 分页列表：keyword（模糊）${parsedFields.some(field => field.search) ? '' : '（未配置 s 字段时搜索恒空）'}${parsedFields.some(field => field.query) ? ' + 精确过滤' : ''} + 白名单排序 */
  async listByQuery(query: List${ModulePascal}Dto): Promise<Pagination<${ModulePascal}Entity>> {
    const qb = this.repository.createQueryBuilder('${moduleCamel}').orderBy('${moduleCamel}.id', 'DESC')
    applyTenantScope(qb, '${moduleCamel}')
    qb.andWhere('${moduleCamel}.delFlag = 0')
    applySort(qb, '${moduleCamel}', query, ${ModulePascal}SORTABLE)
    if (query.keyword) {
${searchConds || "      qb.andWhere('1 = 0') // 未配置 s 字段"}
    }
${queryConds}
    return paginate(qb, { page: query.page, pageSize: query.pageSize })
  }

  /** 新增：唯一键查重 + 落 createBy；并发写兜底捕获 ER_DUP_ENTRY 转 400 */
  async create(dto: Create${ModulePascal}Dto): Promise<${ModulePascal}Entity> {
    await this.assertAllUnique(dto)
    try {
      return await super.create({ ...dto, createBy: TenantContext.userId() })
    } catch (error) {
      if (isDuplicateEntryError(error)) {
        throw new BadRequestException('${label}与已有数据冲突（唯一约束），请检查${uniqueFields.map(field => field.comment).join('、') || '唯一字段'}是否重复')
      }
      throw error
    }
  }

  /** 修改：唯一键查重（排除自身）+ 落 updateBy */
  async update(id: number, dto: Update${ModulePascal}Dto): Promise<${ModulePascal}Entity> {
    await this.findOne(id)
    await this.assertAllUnique(dto, id)
    try {
      return await super.update(id, { ...dto, updateBy: TenantContext.userId() })
    } catch (error) {
      if (isDuplicateEntryError(error)) {
        throw new BadRequestException('${label}与已有数据冲突（唯一约束），请检查${uniqueFields.map(field => field.comment).join('、') || '唯一字段'}是否重复')
      }
      throw error
    }
  }

  /** 软删除：del_flag 置 1；软删行仍占用唯一键，与查重「含软删占用」配套 */
  async delete(id: number): Promise<void> {
    const entity = await this.findOne(id)
    await this.repository.update(entity.id, { delFlag: 1 })
  }
}
`
)

// ---------- v1 controller ----------
const controllerFile = path.join(serverRoot, `src/modules/${moduleSnake}/${moduleSnake}.v1.controller.ts`)
writeIfAbsent(
  controllerFile,
  `import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../common/decorators/oper-log.decorator'
import { Perms } from '../../common/decorators/perms.decorator'
import { Create${ModulePascal}Dto, List${ModulePascal}Dto, Update${ModulePascal}Dto } from './dto/${moduleSnake}.dto'
import { ${ModulePascal}Service } from './${moduleSnake}.service'

/** ${label} v1 接口：统一挂 /api/v1，按钮权限 ${permsPrefix}:* */
@ApiTags('${label}')
@ApiBearerAuth('jwt')
@Controller('v1/${moduleSnake}s')
export class ${ModulePascal}V1Controller {
  constructor(private readonly ${moduleCamel}Service: ${ModulePascal}Service) {}

  @ApiOperation({ summary: '${label}分页', description: '需 ${permsPrefix}:list' })
  @Perms('${permsPrefix}:list')
  @Get()
  list(@Query() query: List${ModulePascal}Dto) {
    return this.${moduleCamel}Service.listByQuery(query)
  }

  @ApiOperation({ summary: '${label}详情', description: '需 ${permsPrefix}:list' })
  @Perms('${permsPrefix}:list')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.${moduleCamel}Service.findOne(id)
  }

  @ApiOperation({ summary: '新增${label}', description: '需 ${permsPrefix}:add' })
  @Perms('${permsPrefix}:add')
  @OperLog('${label}')
  @Post()
  create(@Body() dto: Create${ModulePascal}Dto) {
    return this.${moduleCamel}Service.create(dto)
  }

  @ApiOperation({ summary: '修改${label}', description: '需 ${permsPrefix}:update' })
  @Perms('${permsPrefix}:update')
  @OperLog('${label}')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: Update${ModulePascal}Dto) {
    return this.${moduleCamel}Service.update(id, dto)
  }

  @ApiOperation({ summary: '删除${label}', description: '需 ${permsPrefix}:delete' })
  @Perms('${permsPrefix}:delete')
  @OperLog('${label}')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.${moduleCamel}Service.delete(id)
  }
}
`
)

// ---------- module ----------
const moduleFile = path.join(serverRoot, `src/modules/${moduleSnake}/${moduleSnake}.module.ts`)
writeIfAbsent(
  moduleFile,
  `import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { ${ModulePascal}Entity } from './entities/${moduleSnake}.entity'
import { ${ModulePascal}V1Controller } from './${moduleSnake}.v1.controller'
import { ${ModulePascal}Service } from './${moduleSnake}.service'

/** ${label}模块（生成器产物） */
@Module({
  imports: [TypeOrmModule.forFeature([${ModulePascal}Entity])],
  controllers: [${ModulePascal}V1Controller],
  providers: [${ModulePascal}Service],
  exports: [${ModulePascal}Service]
})
export class ${ModulePascal}Module {}
`
)

// ---------- 迁移 ----------
const timestamp = Date.now()
const migrationColumns = [
  '`id` int NOT NULL AUTO_INCREMENT',
  '`tenant_id` int NOT NULL DEFAULT 1 COMMENT \'租户ID(0=平台共享)\'',
  ...parsedFields.map(field => {
    const typeMap = TYPE_MAP[field.type]
    let comment = field.comment
    if (field.type === 'enum') comment += `(${field.enumValues.map(item => `${item.value}:${item.label}`).join(' ')})`
    const defaultSql =
      field.default !== undefined
        ? ` DEFAULT '${field.default}'`
        : field.required
          ? ''
          : ' DEFAULT NULL'
    return `\`${field.name}\` ${typeMap.mysql}${field.required ? ' NOT NULL' : ' NULL'}${defaultSql} COMMENT '${comment}'`
  }),
  '`create_by` varchar(32) NULL COMMENT \'创建人\'',
  '`update_by` varchar(32) NULL COMMENT \'更新人\'',
  '`del_flag` tinyint NOT NULL DEFAULT 0 COMMENT \'0正常 1已删除\'',
  '`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)',
  '`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)'
].join(',\n        ')

const uniqueKeys = uniqueFields
  .map(field => `, UNIQUE KEY \\\`uniq_${table}_${field.name}\\\` (\\\`tenant_id\\\`, \\\`${field.name}\\\`)`)
  .join('')

const upSql = `CREATE TABLE IF NOT EXISTS \\\`${table}\\\` (
        ${migrationColumns.replace(/`/g, '\\`')},
        PRIMARY KEY (\\\`id\\\`),
        KEY \\\`idx_${table}_tenant\\\` (\\\`tenant_id\\\`)${uniqueKeys}
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='${label}'`

const menuRows = [
  `('menu_${moduleSnake}', '${menuParent}', '${label}管理', '/system/${moduleSnake}s', NULL, 1, 1, '${permsPrefix}:list', '0', ${menuSort}, '${feIcon}', 0, 0, 0, 1, '1', 'tenant')`,
  `('menu_${moduleSnake}_add', 'menu_${moduleSnake}', '新增${label}', NULL, NULL, 1, 2, '${permsPrefix}:add', '0', 1, NULL, 1, 0, 0, 1, '1', 'tenant')`,
  `('menu_${moduleSnake}_edit', 'menu_${moduleSnake}', '编辑${label}', NULL, NULL, 1, 2, '${permsPrefix}:update', '0', 2, NULL, 1, 0, 0, 1, '1', 'tenant')`,
  `('menu_${moduleSnake}_del', 'menu_${moduleSnake}', '删除${label}', NULL, NULL, 1, 2, '${permsPrefix}:delete', '0', 3, NULL, 1, 0, 0, 1, '1', 'tenant')`
].join(',\n        ')

const menuUpSql = `INSERT IGNORE INTO \`sys_permission\`
        (\`id\`, \`parent_id\`, \`name\`, \`url\`, \`component\`, \`is_route\`, \`menu_type\`, \`perms\`, \`perms_type\`, \`sort_no\`, \`icon\`, \`is_leaf\`, \`hidden\`, \`del_flag\`, \`rule_flag\`, \`status\`, \`scope\`)
      VALUES
        ${menuRows}`
  .replace(/`/g, '\\`')

// 表已存在（重新生成）时只补缺失列：CREATE TABLE IF NOT EXISTS 对旧表不生效，
// 不补列就会出现「代码里有这个字段、库里没有」→ 运行时 SQL 报 Unknown column
const missingFields = existingColumns.length === 0 ? [] : parsedFields.filter(field => !existingColumns.includes(field.name))

/** ALTER 片段：全部走「现查 information_schema 再决定」，所以迁移重复执行也安全 */
function buildAlterBlock() {
  if (missingFields.length === 0) return ''
  const addColumns = missingFields
    .map(field => {
      const typeMap = TYPE_MAP[field.type]
      let comment = field.comment
      if (field.type === 'enum') comment += `(${field.enumValues.map(item => `${item.value}:${item.label}`).join(' ')})`
      const defaultSql = field.default !== undefined ? ` DEFAULT '${field.default}'` : field.required ? '' : ' DEFAULT NULL'
      const sql = `ALTER TABLE \`${table}\` ADD COLUMN \`${field.name}\` ${typeMap.mysql}${field.required ? ' NOT NULL' : ' NULL'}${defaultSql} COMMENT '${comment}'`
      return `    if (!existingColumns.has(${JSON.stringify(field.name)})) {
      await queryRunner.query(${JSON.stringify(sql)})
    }`
    })
    .join('\n')
  // 新增且要求唯一的列，唯一索引不会随 CREATE TABLE 一起生效，得单独补
  const addUniques = missingFields
    .filter(field => field.unique)
    .map(field => {
      const indexName = `uniq_${table}_${field.name}`
      const sql = `ALTER TABLE \`${table}\` ADD UNIQUE KEY \`${indexName}\` (\`tenant_id\`, \`${field.name}\`)`
      return `    if (!existingIndexes.has(${JSON.stringify(indexName)})) {
      await queryRunner.query(${JSON.stringify(sql)})
    }`
    })
    .join('\n')
  return `
    const columnRows: Array<{ c: string }> = await queryRunner.query(
      ${JSON.stringify(
        `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
      )}
    )
    const existingColumns = new Set(columnRows.map(row => row.c))
${addColumns}${
    addUniques
      ? `
    const indexRows: Array<{ n: string }> = await queryRunner.query(
      ${JSON.stringify(
        `SELECT DISTINCT INDEX_NAME AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
      )}
    )
    const existingIndexes = new Set(indexRows.map(row => row.n))
${addUniques}`
      : ''
  }
`
}

const alterBlock = buildAlterBlock()

const migrationFile = path.join(serverRoot, `src/migrations/${timestamp}-Gen${ModulePascal}.ts`)
const migrationContent = `import { type MigrationInterface, type QueryRunner } from 'typeorm'

/** 生成器产物：${label}表（${table}）+ 菜单节点（租户级，挂 ${menuParent} 下）${missingFields.length > 0 ? `\n * 目标表已存在：本迁移会补齐 ${missingFields.map(field => field.name).join('、')} 等缺失列，已有列的类型与默认值不动` : ''} */
export class Gen${ModulePascal}${timestamp} implements MigrationInterface {
  name = 'Gen${ModulePascal}${timestamp}'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(\`
      ${upSql}
    \`)
${alterBlock}    await queryRunner.query(\`
      ${menuUpSql}
    \`)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 只回滚生成器写入的 4 个精确菜单节点：绝不用 LIKE 'menu_${moduleSnake}%'（会误删 menu_${moduleSnake}_other 之类）
    const menuIds = ['menu_${moduleSnake}', 'menu_${moduleSnake}_add', 'menu_${moduleSnake}_edit', 'menu_${moduleSnake}_del']
    await queryRunner.query(
      "DELETE FROM \`sys_role_permission\` WHERE \`permission_id\` IN (SELECT \`id\` FROM \`sys_permission\` WHERE \`id\` IN ('" + menuIds.join("','") + "'))"
    )
    await queryRunner.query("DELETE FROM \`sys_permission\` WHERE \`id\` IN ('" + menuIds.join("','") + "')")
    // 故意不 DROP 业务表：回滚只撤销菜单授权；删表会丢数据，需要人工确认后手工执行
  }
}
`

// 重复生成同一模块时不要每次都塞一份迁移：仓库里已有内容相同（只差时间戳）的就跳过
const migrationDir = path.join(serverRoot, 'src/migrations')
const siblingMigrations = (fs.existsSync(migrationDir) ? fs.readdirSync(migrationDir) : []).filter(name => name.endsWith(`-Gen${ModulePascal}.ts`))
const normalizeMigration = text => text.replace(/\d{13}/g, '<timestamp>')
const sameMigrationExists = siblingMigrations.some(
  name => normalizeMigration(fs.readFileSync(path.join(migrationDir, name), 'utf8')) === normalizeMigration(migrationContent)
)
const migrationSkipped = NO_MIGRATION || sameMigrationExists
if (NO_MIGRATION) console.log('跳过迁移生成（--no-migration）：表已存在且不需要补列')
else if (sameMigrationExists) console.log('跳过迁移生成（仓库已有内容相同的迁移，只差时间戳）')
else writeIfAbsent(migrationFile, migrationContent)

// ==================== 前端 ====================

const feFields = parsedFields.map(field => ({ ...field, tsName: tsProp(field.name) }))
const feApiFields = feFields.map(field => `  ${field.tsName}?: ${TYPE_MAP[field.type].ts} | null`).join('\n')

const apiFile = path.join(adminRoot, `src/features/${moduleSnake}/api.ts`)
writeIfAbsent(
  apiFile,
  `import { getApiResult, type PageResult } from '@/lib/http'

/** ${label}（生成器产物） */
export interface ${ModulePascal} {
  id: number
${feApiFields}
  createBy?: string | null
  updateBy?: string | null
  createdAt: string
  updatedAt: string
}

export type ${ModulePascal}WritePayload = Partial<Omit<${ModulePascal}, 'id' | 'createBy' | 'updateBy' | 'createdAt' | 'updatedAt'>>

/** 列表查询参数：分页/排序与后端 PagerDto 对齐，业务过滤项（query 字段）可选追加 */
export interface ${ModulePascal}ListParams {
  page?: number
  pageSize?: number
  keyword?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
${feFields.filter(field => field.query).map(field => `  ${field.tsName}?: ${TYPE_MAP[field.type].ts}`).join('\n')}
}

export function fetch${ModulePascal}s(params: ${ModulePascal}ListParams = {}) {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') qs.set(key, String(value))
  })
  return getApiResult<PageResult<${ModulePascal}>>(\`/backend-api/v1/${moduleSnake}s?\${qs.toString()}\`)
}

export function create${ModulePascal}(payload: ${ModulePascal}WritePayload) {
  return getApiResult<${ModulePascal}>('/backend-api/v1/${moduleSnake}s', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
}

export function update${ModulePascal}(id: number, payload: ${ModulePascal}WritePayload) {
  return getApiResult<${ModulePascal}>(\`/backend-api/v1/${moduleSnake}s/\${id}\`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
}

export function delete${ModulePascal}(id: number) {
  return getApiResult<unknown>(\`/backend-api/v1/${moduleSnake}s/\${id}\`, { method: 'DELETE' })
}
`
)

// 表格单元格渲染（按控件类型分派）
const feCell = field => {
  const value = `row.getValue('${field.tsName}')`
  if (field.type === 'enum') {
    return `const labels = ${ModulePascal}EnumLabels
        return <span>{labels[row.getValue<number>('${field.tsName}')] ?? '-'}</span>`
  }
  if (field.type === 'bool') {
    return `return <StatusBadge ok={!!${value}} label={${value} ? '是' : '否'} />`
  }
  if (field.type === 'datetime') {
    return `const text = String(${value} ?? '').replace('T', ' ').slice(0, 16)
        return <span className="tabular-nums">{text || '-'}</span>`
  }
  if (NUMERIC_TYPES.includes(field.type)) {
    return `return <span className="tabular-nums">{${value} ?? '-'}</span>`
  }
  if (field.type === 'text') {
    return `return <span className="text-muted-foreground block max-w-64 truncate">{${value} || '-'}</span>`
  }
  return `return <span className="font-medium">{${value} || '-'}</span>`
}

const feColumns = feFields
  .map(
    field => `      {
        accessorKey: '${field.tsName}',
        header: ({ column }) => <DataTableColumnHeader column={column} title="${field.comment}" />,
        enableSorting: ${field.type === 'text' ? 'false' : 'true'},
        cell: ({ row }) => {
  ${feCell(field)}
        }
      }`
  )
  .join(',\n')

const enumLabelConsts = feFields
  .filter(field => field.type === 'enum')
  .map(
    field => `const ${ModulePascal}EnumLabels: Record<number, string> = {
${field.enumValues.map(item => `  ${item.value}: '${item.label}'`).join(',\n')}
}`
  )
  .join('\n\n')

const drawerFile = path.join(adminRoot, `src/features/${moduleSnake}/components/${moduleSnake}-form-drawer.tsx`)
const feHasType = type => feFields.some(field => field.type === type)
const drawerImports = [
  "import { useState } from 'react'",
  "import type { FormEvent } from 'react'",
  "import { Input } from '@/components/ui/input'",
  'import { Label } from \'@/components/ui/label\''
]
if (feHasType('enum')) drawerImports.push("import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'")
if (feHasType('bool')) drawerImports.push("import { Switch } from '@/components/ui/switch'")
if (feHasType('text')) drawerImports.push("import { Textarea } from '@/components/ui/textarea'")
drawerImports.push("import { AppDrawer } from '@/components/app-drawer'", `import type { ${ModulePascal}, ${ModulePascal}WritePayload } from '../api'`)
const datetimeHelper = feHasType('datetime')
  ? `const toDatetimeInput = (value?: string | null) => (value ? String(value).slice(0, 16) : '')\n\n`
  : ''
writeIfAbsent(
  drawerFile,
  `${drawerImports.join('\n')}

interface ${ModulePascal}FormDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 编辑对象；null 表示新增 */
  ${moduleCamel}: ${ModulePascal} | null
  onSubmit: (values: ${ModulePascal}WritePayload) => void
}

${datetimeHelper}/** ${label}新增/编辑抽屉（生成器产物：AppDrawer 表单模式，回车提交、原生校验生效） */
export function ${ModulePascal}FormDrawer({ open, onOpenChange, ${moduleCamel}: editing, onSubmit }: ${ModulePascal}FormDrawerProps) {
  const [form, setForm] = useState<Partial<${ModulePascal}>>(editing ?? {})
  const isEdit = editing !== null

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    onSubmit(form as ${ModulePascal}WritePayload)
  }

  return (
    <AppDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? '编辑${label}' : '新增${label}'}
      description={isEdit ? '修改后点击保存立即生效' : '填写完成后点击保存'}
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
${feFields
  .map(field => {
    const required = field.required
    const labelNode = `          <Label htmlFor="${field.tsName}">${required ? '<span className="text-destructive">*</span> ' : ''}${field.comment}</Label>`
    if (field.type === 'text') {
      return `        <div className="space-y-1.5">
${labelNode}
          <Textarea
            id="${field.tsName}"
            rows={3}
            value={String(form.${field.tsName} ?? '')}
            onChange={e => setForm(prev => ({ ...prev, ${field.tsName}: e.target.value || undefined }))}
          />
        </div>`
    }
    if (field.type === 'bool') {
      return `        <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
          <Label htmlFor="${field.tsName}">${field.comment}</Label>
          <Switch
            id="${field.tsName}"
            checked={!!form.${field.tsName}}
            onCheckedChange={checked => setForm(prev => ({ ...prev, ${field.tsName}: checked }))}
          />
        </div>`
    }
    if (field.type === 'enum') {
      return `        <div className="space-y-1.5">
${labelNode}
          <Select
            value={form.${field.tsName} !== undefined && form.${field.tsName} !== null ? String(form.${field.tsName}) : undefined}
            onValueChange={value => setForm(prev => ({ ...prev, ${field.tsName}: Number(value) }))}
          >
            <SelectTrigger id="${field.tsName}" className="w-full">
              <SelectValue placeholder="请选择${field.comment}" />
            </SelectTrigger>
            <SelectContent>
${field.enumValues.map(item => `              <SelectItem value="${item.value}">${item.label}</SelectItem>`).join('\n')}
            </SelectContent>
          </Select>
        </div>`
    }
    if (field.type === 'datetime') {
      return `        <div className="space-y-1.5">
${labelNode}
          <Input
            id="${field.tsName}"
            type="datetime-local"
            value={toDatetimeInput(form.${field.tsName})}
            onChange={e => setForm(prev => ({ ...prev, ${field.tsName}: e.target.value || undefined }))}
          />
        </div>`
    }
    if (NUMERIC_TYPES.includes(field.type)) {
      return `        <div className="space-y-1.5">
${labelNode}
          <Input
            id="${field.tsName}"
            type="number"
            value={form.${field.tsName} ?? ''}
            onChange={e => setForm(prev => ({ ...prev, ${field.tsName}: e.target.value === '' ? undefined : Number(e.target.value) }))}
          />
        </div>`
    }
    return `        <div className="space-y-1.5">
${labelNode}
          <Input
            id="${field.tsName}"
            ${required ? 'required ' : ''}value={String(form.${field.tsName} ?? '')}
            onChange={e => setForm(prev => ({ ...prev, ${field.tsName}: e.target.value }))}
          />
        </div>`
  })
  .join('\n')}
      </div>
    </AppDrawer>
  )
}
`
)

const indexFile = path.join(adminRoot, `src/features/${moduleSnake}/index.tsx`)
writeIfAbsent(
  indexFile,
  `import { useCallback, useMemo, useState } from 'react'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { RefreshButton } from '@/components/ui/refresh-button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
${feHasType('bool') ? "import { StatusBadge } from '@/components/status-badge'\n" : ''}import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTable, DataTableColumnHeader, DataTablePagination, DataTableViewOptions, useServerTable, type ServerTableQuery } from '@/components/data-table'
import { hasPermission } from '@/lib/auth'
import {
  create${ModulePascal},
  delete${ModulePascal},
  fetch${ModulePascal}s,
  update${ModulePascal},
  type ${ModulePascal},
  type ${ModulePascal}WritePayload
} from './api'
import { ${ModulePascal}FormDrawer } from './components/${moduleSnake}-form-drawer'

${enumLabelConsts ? enumLabelConsts + '\n\n' : ''}const columnLabels: Record<string, string> = {
${feFields.map(field => `  ${field.tsName}: '${field.comment}'`).join(',\n')},
  actions: '操作'
}

/** ${label}管理（生成器产物：服务端分页/筛选/排序 + 抽屉表单规约） */
export function ${ModulePascal}Page() {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<${ModulePascal} | null>(null)
  const [deleting, setDeleting] = useState<${ModulePascal} | null>(null)

  /** 列表查询：搜索/排序/翻页全部交给后端，query 字段作额外过滤条件 */
  const fetchPage = useCallback(
    ({ page, pageSize, keyword, sortBy, sortOrder }: ServerTableQuery<Record<string, never>>) =>
      fetch${ModulePascal}s({ page, pageSize, keyword, sortBy, sortOrder }),
    []
  )

  const columns = useMemo<ColumnDef<${ModulePascal}>[]>(
    () => [
${feColumns},
      {
        id: 'actions',
        header: () => <div className="text-end">操作</div>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="text-end">
            {hasPermission('${permsPrefix}:update') && (
              <Button variant="ghost" size="icon" onClick={() => { setEditing(row.original); setFormOpen(true) }}>
                <Pencil className="size-4" />
                <span className="sr-only">编辑</span>
              </Button>
            )}
            {hasPermission('${permsPrefix}:delete') && (
              <Button variant="ghost" size="icon" onClick={() => setDeleting(row.original)}>
                <Trash2 className="text-destructive size-4" />
                <span className="sr-only">删除</span>
              </Button>
            )}
          </div>
        )
      }
    ],
    []
  )

  const { table, keyword, setKeyword, loading, booted, error, total, reload } = useServerTable({
    columns,
    query: fetchPage,
    getRowId: item => String(item.id)
  })

  const handleSubmit = (values: ${ModulePascal}WritePayload) => {
    const request = editing ? update${ModulePascal}(editing.id, values) : create${ModulePascal}(values)
    request
      .then(() => {
        toast.success(editing ? '${label}已更新' : '${label}已创建')
        setFormOpen(false)
        reload()
      })
      .catch(e => toast.error(e instanceof Error ? e.message : '保存失败'))
  }

  const handleDelete = () => {
    if (!deleting) return
    delete${ModulePascal}(deleting.id)
      .then(() => {
        toast.success('已删除')
        reload()
      })
      .catch(e => toast.error(e instanceof Error ? e.message : '删除失败'))
    setDeleting(null)
  }

  const firstTextField = '${feFields.find(field => field.type === "string")?.tsName ?? "id"}'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">${label}管理</h1>
          <p className="text-muted-foreground text-sm">共 {total >= 0 ? total : 0} 个${label}</p>
        </div>
        {hasPermission('${permsPrefix}:add') && (
          <Button
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            <Plus />
            新增${label}
          </Button>
        )}
      </div>

      {!booted ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            <Skeleton className="h-9 w-full max-w-md" />
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <p className="text-muted-foreground text-sm">{error}</p>
            <Button variant="outline" onClick={reload}>
              重试
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full max-w-xs">
                <Search className="text-muted-foreground absolute start-2.5 top-1/2 size-4 -translate-y-1/2" />
                <Input placeholder="搜索" className="ps-8" value={keyword} onChange={e => setKeyword(e.target.value)} />
              </div>
              <RefreshButton onClick={() => void reload()} className="ms-auto" />
              <DataTableViewOptions table={table} columnLabels={columnLabels} />
            </div>

            <DataTable table={table} loading={loading} emptyText="没有匹配的${label}" />
            <DataTablePagination table={table} />
          </CardContent>
        </Card>
      )}

      {formOpen && (
        <${ModulePascal}FormDrawer key={editing?.id ?? 'new'} open={formOpen} onOpenChange={setFormOpen} ${moduleCamel}={editing} onSubmit={handleSubmit} />
      )}

      <ConfirmDialog
        confirmText="删除"
        open={!!deleting}
        onOpenChange={v => !v && setDeleting(null)}
        title="删除${label}"
        description={<>即将删除${label}「{String(deleting?.[firstTextField as keyof ${ModulePascal}] ?? deleting?.id)}」，该操作为软删除，可在数据库恢复。</>}
        onConfirm={handleDelete}
      />
    </div>
  )
}
`
)

// ==================== 自动注册 ====================

function readFileOrWarn(file, labelForLog) {
  if (!fs.existsSync(file)) {
    console.warn(`⚠️ 注册失败（文件不存在）: ${labelForLog}`)
    return null
  }
  return fs.readFileSync(file, 'utf8')
}

function saveRegistered(file, content) {
  if (DRY_RUN) {
    console.log(`[dry-run] 将注册: ${path.relative(serverRoot, file)}`)
    return
  }
  fs.writeFileSync(file, content)
}

if (!NO_REGISTER) {
  console.log('\n--- 自动注册 ---')

  // 1. 后端 app.module.ts：import + imports 数组
  const appModulePath = path.join(serverRoot, 'src/app.module.ts')
  let appModule = readFileOrWarn(appModulePath, 'app.module.ts')
  if (appModule) {
    appModule = injectAfterLast(appModule, /from '\.\/modules\/.*module'/, `import { ${ModulePascal}Module } from './modules/${moduleSnake}/${moduleSnake}.module'`, 'app.module import')
    appModule = injectAfterLast(appModule, /^\s+\w+Module,$/, `    ${ModulePascal}Module,`, 'app.module imports')
    saveRegistered(appModulePath, appModule)
  }

  if (fs.existsSync(adminRoot)) {
    // 2. 前端路由文件
    const routePath = path.join(adminRoot, `src/routes/_authenticated/system/${moduleSnake}s.tsx`)
    if (fs.existsSync(routePath)) {
      console.log(`路由跳过（已存在）: src/routes/_authenticated/system/${moduleSnake}s.tsx`)
    } else {
      writeFile(
        routePath,
        `import { createFileRoute } from '@tanstack/react-router'
import { ${ModulePascal}Page } from '@/features/${moduleSnake}'

export const Route = createFileRoute('/_authenticated/system/${moduleSnake}s')({
  component: ${ModulePascal}Page
})
`
      )
    }

    // 3. page-registry：import + 登记
    const registryPath = path.join(adminRoot, 'src/config/page-registry.ts')
    let registry = readFileOrWarn(registryPath, 'page-registry.ts')
    if (registry) {
      const hasIcon = registry.includes(`  ${feIcon},`)
      const icon = hasIcon ? feIcon : 'BookOpen'
      registry = injectAfterLast(registry, /import \{ \w+Page \} from '@\/features\//, `import { ${ModulePascal}Page } from '@/features/${moduleSnake}'`, 'page-registry import')
      registry = injectAfterLast(
        registry,
        /export const PAGE_REGISTRY: Record<string, PageEntry> = \{/,
        `  '/system/${moduleSnake}s': { component: ${ModulePascal}Page, titleKey: 'nav.system.${moduleCamel}', icon: ${icon} },`,
        'page-registry entry'
      )
      saveRegistered(registryPath, registry)
    }

    // 4. i18n：中英各一条 nav.system 键（中文行后插中文、英文行后插英文）
    const i18nPath = path.join(adminRoot, 'src/config/i18n.ts')
    let i18n = readFileOrWarn(i18nPath, 'i18n.ts')
    if (i18n) {
      const navLines = i18n.split('\n').filter(line => /'nav\.system\.[A-Za-z]+': '[^']+',/.test(line))
      const zhLines = navLines.filter(line => /[\u4e00-\u9fa5]/.test(line))
      const enLines = navLines.filter(line => !/[\u4e00-\u9fa5]/.test(line))
      if (zhLines.length && enLines.length) {
        i18n = injectAfterLast(i18n, /'nav\.system\.[A-Za-z]+': '[^']*[\u4e00-\u9fa5][^']*',/, `  'nav.system.${moduleCamel}': '${label}',`, 'i18n zh')
        i18n = injectAfterLast(i18n, /'nav\.system\.[A-Za-z]+': '[A-Za-z0-9 .()\-]+',/, `  'nav.system.${moduleCamel}': '${moduleCamel}',`, 'i18n en')
        saveRegistered(i18nPath, i18n)
      } else {
        console.warn('⚠️ 注册失败（i18n 里找不到 nav.system 中英锚点，请手工补 nav.system.' + moduleCamel + '）')
      }
    }
  } else {
    console.warn(`⚠️ 前端目录不存在，跳过前端注册: ${adminRoot}`)
  }
}

console.log(`
完成${DRY_RUN ? '（dry-run 预览，未写任何文件）' : ''}。产物 ${writeCount.ok} 个文件${
  overwrittenFiles.length > 0
    ? `（其中覆盖 ${overwrittenFiles.length} 个，旧文件已备份到 ${path.relative(serverRoot, backupRoot)}）`
    : ''
}，跳过已存在 ${writeCount.skip} 个。

接下来手动做两件事：
${
  migrationSkipped
    ? `  1. 本次没有生成迁移文件（表结构与已有迁移一致）；菜单节点若缺失请手写 INSERT`
    : `  1. npx typeorm migration:run
     （迁移已带上菜单节点 menu_${moduleSnake}（${menuParent} 下，租户级）+ 三个按钮权限${
       missingFields.length > 0 ? `，并补齐 ${missingFields.map(field => field.name).join('、')} 等缺失列` : ''
     }）`
}
  2. 让各租户的角色模板拿到新菜单：POST /v1/tenants/provision-all
     （之后退出重登即可在侧边栏看到「${label}管理」）
`)

if (JSON_OUT) {
  // 单行机器可读清单，前缀标记便于调用方从日志里定位（页面接口解析这一行）
  console.log(
    `__CODEGEN__${JSON.stringify({
      ok: true,
      module: moduleSnake,
      label,
      table,
      menuId: `menu_${moduleSnake}`,
      created: written,
      skipped: skippedFiles,
      overwritten: overwrittenFiles,
      backupDir: overwrittenFiles.length > 0 ? backupRoot : undefined,
      migrationSkipped,
      addedColumns: missingFields.map(field => field.name),
      dryRun: DRY_RUN,
      staged: Boolean(OUT_ROOT),
      stagedStatus: OUT_ROOT ? stagedFileStatus : undefined
    })}`
  )
}
