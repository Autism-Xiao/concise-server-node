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

const moduleSnake = argOf('--module')
const label = argOf('--label', moduleSnake)
if (!moduleSnake || !label) usageAndExit()
if (!/^[a-z][a-z0-9_]*$/.test(moduleSnake)) {
  console.error(`--module 须为小写蛇形（如 customer / biz_order），收到：${moduleSnake}`)
  process.exit(1)
}
const moduleCamel = moduleSnake.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
const ModulePascal = moduleCamel[0].toUpperCase() + moduleCamel.slice(1)
const permsPrefix = argOf('--perms', moduleSnake)
const table = argOf('--table', moduleSnake)
const menuParent = argOf('--menu-parent', 'menu_collab')
const menuSort = Number(argOf('--sort', '50'))
const feIcon = argOf('--icon', 'Briefcase')
const adminRoot = argOf('--admin', path.resolve(process.cwd(), '../concise-admin'))
const serverRoot = process.cwd()

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

const fieldsArg = argOf('--fields')
if (!fieldsArg) usageAndExit()
const parsedFields = fieldsArg
  .split(',')
  .map(raw => raw.trim())
  .filter(Boolean)
  .map(raw => {
    // 选项可能含冒号（enum 的 e=1:启用），把第 3 个冒号之后的全部并回选项
    const parts = raw.split(':')
    const [name, type, comment] = parts
    const options = parts.slice(3).join(':') ?? ''
    if (!name || !TYPE_MAP[type]) {
      console.error(`字段「${raw}」不合法（类型须为 ${Object.keys(TYPE_MAP).join('/')}）`)
      process.exit(1)
    }
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      console.error(`字段名「${name}」须为小写蛇形`)
      process.exit(1)
    }
    const defaultMatch = options.match(/default=([^,]+)/)
    const enumMatch = options.match(/e=([^,]+)/)
    const flagStr = options.replace(/default=[^,]+/g, '').replace(/e=[^,]+/g, '').replace(/[,\s]/g, '')
    const field = {
      name,
      type,
      comment: comment || name,
      required: flagStr.includes('r'),
      unique: flagStr.includes('u'),
      query: flagStr.includes('q'),
      search: flagStr.includes('s'),
      default: defaultMatch?.[1],
      enumValues: []
    }
    if (type === 'enum') {
      if (!enumMatch) {
        console.error(`enum 字段「${name}」缺少 e= 值:标签 选项（如 e=1:普通|2:VIP）`)
        process.exit(1)
      }
      field.enumValues = enumMatch[1].split('|').map(pair => {
        const [value, enumLabel] = pair.split(':')
        if (value === undefined || enumLabel === undefined) {
          console.error(`enum 字段「${name}」选项「${pair}」不合法，应为 值:标签`)
          process.exit(1)
        }
        return { value: Number(value), label: enumLabel }
      })
      if (field.default !== undefined && !field.enumValues.some(item => item.value === Number(field.default))) {
        console.error(`enum 字段「${name}」默认值 ${field.default} 不在枚举值里`)
        process.exit(1)
      }
    }
    return field
  })

const pascal = name => name.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())
const tsProp = name => pascal(name)[0].toLowerCase() + pascal(name).slice(1)
const writeCount = { ok: 0, skip: 0 }
function writeFile(file, content) {
  const rel = path.relative(serverRoot, file)
  if (DRY_RUN) {
    console.log(`[dry-run] 将生成: ${rel}`)
    return
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  writeCount.ok++
  console.log(`生成: ${rel}`)
}
function writeIfAbsent(file, content) {
  if (fs.existsSync(file)) {
    console.log(`跳过（已存在）: ${path.relative(serverRoot, file)}`)
    writeCount.skip++
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
const validatorImports = [...usedValidators].filter(name => name !== 'Type' && !name.startsWith('Api')).join(', ') || 'IsOptional'
const listDtoValidators = 'IsInt, IsOptional, MaxLength'
const needsType = usedValidators.has('Type')

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

export class Create${ModulePascal}Dto {
${createDtoFields}
}

export class Update${ModulePascal}Dto {
${updateDtoFields}
}

/** 列表查询参数：page/pageSize 必须显式转数字，否则 ValidationPipe 白名单会丢弃字符串形态的分页 */
export class List${ModulePascal}Dto {
  @ApiPropertyOptional({ description: '页码，从 1 起' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  page?: number

  @ApiPropertyOptional({ description: '每页条数' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  pageSize?: number

  @ApiPropertyOptional({ description: '模糊搜索关键字' })
  @IsOptional()
  @MaxLength(64, { message: '关键字最长 64 位' })
  keyword?: string
${listQueryFields ? `\n\n${listQueryFields}` : ''}
}
`
)

// ---------- service ----------
const searchConds = parsedFields
  .filter(field => field.search)
  .map(field => `      qb.andWhere('${moduleCamel}.${field.name} LIKE :keyword', { keyword: \`%\${query.keyword}%\` })`)
  .join('\n')
const queryConds = parsedFields
  .filter(field => field.query)
  .map(field => {
    const name = tsProp(field.name)
    return `    if (query.${name} !== undefined && query.${name} !== null) {
      qb.andWhere('${moduleCamel}.${field.name} = :${name}', { ${name}: query.${name} })
    }`
  })
  .join('\n')
const uniqueFields = parsedFields.filter(field => field.unique)
const uniquePropList = uniqueFields.map(field => `'${field.name}'`).join(', ') || 'never[]'
const uniqueLabelMap = uniqueFields.map(field => `    ${field.name}: '${field.comment}'`).join('\n') || '    // 无唯一字段'

const serviceFile = path.join(serverRoot, `src/modules/${moduleSnake}/${moduleSnake}.service.ts`)
writeIfAbsent(
  serviceFile,
  `import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { isDuplicateEntryError } from '../../utils/db-error.util'
import { BaseService } from '../../helper/crud/base.service'
import { paginate, type Pagination } from '../../helper/paginate'
import { TenantContext } from '../../shared/tenant/tenant.context'
import { applyTenantScope } from '../../shared/tenant/tenant-scope.util'
import { Create${ModulePascal}Dto, List${ModulePascal}Dto, Update${ModulePascal}Dto } from './dto/${moduleSnake}.dto'
import { ${ModulePascal}Entity } from './entities/${moduleSnake}.entity'

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

  /** 分页列表：keyword${parsedFields.some(field => field.search) ? '（模糊）' : ''}${parsedFields.some(field => field.query) ? ' + 精确过滤' : ''} */
  async listByQuery(query: List${ModulePascal}Dto): Promise<Pagination<${ModulePascal}Entity>> {
    const qb = this.repository.createQueryBuilder('${moduleCamel}').orderBy('${moduleCamel}.id', 'DESC')
    applyTenantScope(qb, '${moduleCamel}')
    qb.andWhere('${moduleCamel}.delFlag = 0')
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

const migrationFile = path.join(serverRoot, `src/migrations/${timestamp}-Gen${ModulePascal}.ts`)
writeIfAbsent(
  migrationFile,
  `import { type MigrationInterface, type QueryRunner } from 'typeorm'

/** 生成器产物：${label}表（${table}）+ 菜单节点（租户级，挂 ${menuParent} 下） */
export class Gen${ModulePascal}${timestamp} implements MigrationInterface {
  name = 'Gen${ModulePascal}${timestamp}'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(\`
      ${upSql}
    \`)
    await queryRunner.query(\`
      ${menuUpSql}
    \`)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DELETE FROM \`sys_role_permission\` WHERE \`permission_id\` IN (SELECT \`id\` FROM (SELECT \`id\` FROM \`sys_permission\` WHERE \`id\` LIKE 'menu_${moduleSnake}%') t)"
    )
    await queryRunner.query("DELETE FROM \`sys_permission\` WHERE \`id\` LIKE 'menu_${moduleSnake}%'")
    await queryRunner.query(\`DROP TABLE IF EXISTS \\\`${table}\\\`\`)
  }
}
`
)

// ==================== 前端 ====================

const feFields = parsedFields.map(field => ({ ...field, tsName: tsProp(field.name) }))
const feApiFields = feFields.map(field => `  ${field.tsName}?: ${TYPE_MAP[field.type].ts} | null`).join('\n')

const apiFile = path.join(adminRoot, `src/features/${moduleSnake}/api.ts`)
writeIfAbsent(
  apiFile,
  `import { getApiResult } from '@/lib/http'

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

export function fetch${ModulePascal}s(params: { page?: number; pageSize?: number; keyword?: string } = {}) {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') qs.set(key, String(value))
  })
  return getApiResult<{ records: ${ModulePascal}[]; total: number }>(\`/backend-api/v1/${moduleSnake}s?\${qs.toString()}\`)
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
    return `return <span>{${value} ? '是' : '否'}</span>`
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
  `import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTable, DataTableColumnHeader, DataTablePagination, DataTableViewOptions, useDataTable } from '@/components/data-table'
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

/** ${label}管理（生成器产物：DataTable + 抽屉表单规约） */
export function ${ModulePascal}Page() {
  const [list, setList] = useState<${ModulePascal}[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<${ModulePascal} | null>(null)
  const [deleting, setDeleting] = useState<${ModulePascal} | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    fetch${ModulePascal}s({ pageSize: 500 })
      .then(res => setList(res.records ?? []))
      .catch(e => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const ${moduleCamel}s = useMemo(() => list ?? [], [list])

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

  const { table, keyword, setKeyword } = useDataTable({
    data: ${moduleCamel}s,
    columns,
    getRowId: item => String(item.id)
  })

  const handleSubmit = (values: ${ModulePascal}WritePayload) => {
    const request = editing ? update${ModulePascal}(editing.id, values) : create${ModulePascal}(values)
    request
      .then(() => {
        toast.success(editing ? '${label}已更新' : '${label}已创建')
        setFormOpen(false)
        load()
      })
      .catch(e => toast.error(e instanceof Error ? e.message : '保存失败'))
  }

  const handleDelete = () => {
    if (!deleting) return
    delete${ModulePascal}(deleting.id)
      .then(() => {
        toast.success('已删除')
        load()
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
          <p className="text-muted-foreground text-sm">共 {${moduleCamel}s.length} 个${label}</p>
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

      {loading ? (
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
            <Button variant="outline" onClick={load}>
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
              <DataTableViewOptions table={table} columnLabels={columnLabels} />
            </div>

            <DataTable table={table} emptyText="没有匹配的${label}" />
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
完成${DRY_RUN ? '（dry-run 预览，未写任何文件）' : ''}。产物 ${writeCount.ok} 个文件，跳过已存在 ${writeCount.skip} 个。

接下来手动做两件事：
  1. npx typeorm migration:run
     （迁移已带上菜单节点 menu_${moduleSnake}（${menuParent} 下，租户级）+ 三个按钮权限）
  2. 让各租户的角色模板拿到新菜单：POST /v1/tenants/provision-all
     （之后退出重登即可在侧边栏看到「${label}管理」）
`)
