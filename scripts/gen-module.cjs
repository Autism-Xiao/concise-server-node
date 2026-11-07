#!/usr/bin/env node
/* eslint-disable */
/**
 * 代码生成器：一个业务表 → 后端五件套 + 迁移 + 前端页面骨架
 *
 * 用法：
 *   node scripts/gen-module.cjs \
 *     --module supplier \
 *     --label 供应商 \
 *     --perms supplier \
 *     --fields "name:string:名称:rq, contact:string:联系人, phone:string:电话, level:tinyint:级别:default=1, remark:string:备注"
 *
 *   字段格式：名称:类型:中文备注[:选项，逗号分隔]
 *     类型：string / text / int / bigint / tinyint / decimal / datetime / bool
 *     选项：r=必填  u=唯一  q=列表查询过滤  s=keyword 模糊搜索  default=N=默认值
 *
 * 产物：
 *   后端 src/modules/<module>/   entity + dto + service + v1.controller + module
 *        src/migrations/<ts>-Gen<Module>.ts
 *   前端 <admin>/src/features/<module>/  api.ts + index.tsx（表格 + 新增/编辑/删除）
 *
 * 生成后手动做三件事（脚本末尾会再提示）：
 *   1. app.module.ts 注册模块；2. 前端路由 + page-registry + i18n；3. 菜单管理录入权限节点
 *
 * 所有产物遵循项目既定规约：统一响应走控制层、{ code, data, message }、
 * tenant_id 写列、软删 del_flag、@Perms 按钮权限、Pagination 分页、Argon2 无关。
 */
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
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
const moduleCamel = moduleSnake.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
const ModulePascal = moduleCamel[0].toUpperCase() + moduleCamel.slice(1)
const permsPrefix = argOf('--perms', moduleSnake)
const permsPascalLabel = label
const table = argOf('--table', moduleSnake)
const adminRoot = argOf('--admin', path.resolve(process.cwd(), '../concise-admin'))
const serverRoot = process.cwd()

const TYPE_MAP = {
  string: { ts: 'string', mysql: 'VARCHAR(128)', dto: 'IsString', vue: 'text' },
  text: { ts: 'string', mysql: 'TEXT', dto: 'IsString', vue: 'textarea' },
  int: { ts: 'number', mysql: 'INT', dto: 'IsInt', vue: 'number' },
  bigint: { ts: 'number', mysql: 'BIGINT', dto: 'IsInt', vue: 'number' },
  tinyint: { ts: 'number', mysql: 'TINYINT', dto: 'IsInt', vue: 'number' },
  decimal: { ts: 'number', mysql: 'DECIMAL(14,2)', dto: 'IsNumber', vue: 'number' },
  datetime: { ts: 'string', mysql: 'DATETIME', dto: 'IsISO8601', vue: 'datetime' },
  bool: { ts: 'boolean', mysql: 'TINYINT(1)', dto: 'IsBoolean', vue: 'switch' }
}

const fields = argOf('--fields')
if (!fields) usageAndExit()
const parsedFields = fields
  .split(',')
  .map(raw => raw.trim())
  .filter(Boolean)
  .map(raw => {
    const [name, type, comment, optionsRaw] = raw.split(':').map(part => part?.trim() ?? '')
    if (!name || !TYPE_MAP[type]) {
      console.error(`字段「${raw}」不合法（类型须为 ${Object.keys(TYPE_MAP).join('/')}）`)
      process.exit(1)
    }
    const options = optionsRaw ?? ''
    // default=N 提取后，剩余字符（可连写可逗号分隔）逐字符解析旗标：r 必填 / u 唯一 / q 查询过滤 / s 模糊搜索
    const defaultMatch = options.match(/default=([^,]+)/)
    const flagStr = options.replace(/default=[^,]+/g, '').replace(/[,\s]/g, '')
    return {
      name,
      type,
      comment: comment || name,
      required: flagStr.includes('r'),
      unique: flagStr.includes('u'),
      query: flagStr.includes('q'),
      search: flagStr.includes('s'),
      default: defaultMatch?.[1]
    }
  })

const pascal = name => name.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())
const writeIfAbsent = (file, content) => {
  if (fs.existsSync(file)) {
    console.log(`跳过（已存在）: ${path.relative(process.cwd(), file)}`)
    return
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  console.log(`生成: ${path.relative(process.cwd(), file)}`)
}

// ---------- 后端 entity ----------
const entityColumns = parsedFields
  .map(field => {
    const typeMap = TYPE_MAP[field.type]
    const nullable = field.required ? '' : ', nullable: true'
    const defaultValue = field.default !== undefined ? `, default: ${field.type === 'string' || field.type === 'text' ? `'${field.default}'` : field.default}` : ''
    const columnType = ['string', 'text'].includes(field.type)
      ? `{ type: 'varchar', length: 128${nullable}${defaultValue} }`
      : `{ type: '${field.type === 'bool' ? 'tinyint' : field.type}'${nullable}${defaultValue} }`
    return `  @ApiPropertyOptional({ description: '${field.comment}' })
  @Column(${columnType})
  ${pascal(field.name)[0].toLowerCase() + pascal(field.name).slice(1)}?: ${typeMap.ts} | null`
  })
  .join('\n\n')

writeIfAbsent(
  path.join(serverRoot, `src/modules/${moduleSnake}/entities/${moduleSnake}.entity.ts`),
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
const usedValidators = new Set(['ApiProperty', 'ApiPropertyOptional'])
if (parsedFields.some(field => field.required)) usedValidators.add('IsNotEmpty')
if (parsedFields.some(field => !field.required)) usedValidators.add('IsOptional')
for (const field of parsedFields) usedValidators.add(TYPE_MAP[field.type].dto)
if (parsedFields.some(field => ['int', 'bigint', 'tinyint', 'decimal'].includes(field.type))) usedValidators.add('Type')
if (parsedFields.some(field => field.unique)) usedValidators.add('MaxLength')

const dtoFields = parsedFields
  .map(field => {
    const typeMap = TYPE_MAP[field.type]
    const prop = `  @ApiProperty${field.required ? '' : 'Optional'}({ description: '${field.comment}'${field.required ? '' : ', nullable: true'} })`
    let validators = field.required ? `  @IsNotEmpty({ message: '${field.comment}不能为空' })` : '  @IsOptional()'
    validators += `\n  @${typeMap.dto}()`
    if (field.unique) validators += `\n  @MaxLength(128, { message: '${field.comment}最长 128 位' })`
    if (['int', 'bigint', 'tinyint', 'decimal'].includes(field.type)) validators += `\n  @Type(() => Number)`
    return `${prop}
${validators}
  ${pascal(field.name)[0].toLowerCase() + pascal(field.name).slice(1)}${field.required ? '' : '?'}: ${typeMap.ts}`
  })
  .join('\n\n')

writeIfAbsent(
  path.join(serverRoot, `src/modules/${moduleSnake}/dto/${moduleSnake}.dto.ts`),
  `import { ${[...usedValidators].filter(name => name !== 'Type' && !name.startsWith('Api')).join(', ') || 'IsOptional'} } from 'class-validator'
${usedValidators.has('Type') ? "import { Type } from 'class-transformer'\n" : ''}import { ${[...usedValidators].filter(name => name.startsWith('Api')).join(', ')} } from '@nestjs/swagger'

export class Create${ModulePascal}Dto {
${dtoFields}
}

export class Update${ModulePascal}Dto {
${dtoFields
  .split('\n\n')
  .map(block =>
    block
      .replace(/@IsOptional\(\)\n/, '')
      .replace(/@IsNotEmpty\([^)]*\)\n/, '')
  )
  .map(block => block.replace(/: (\w+)$/, ': $1 | null'))
  .join('\n\n')}
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
    const tsName = pascal(field.name)[0].toLowerCase() + pascal(field.name).slice(1)
    return `    if (query.${tsName} !== undefined && query.${tsName} !== null) {
      qb.andWhere('${moduleCamel}.${field.name} = :${tsName}', { ${tsName}: query.${tsName} })
    }`
  })
  .join('\n')

writeIfAbsent(
  path.join(serverRoot, `src/modules/${moduleSnake}/${moduleSnake}.service.ts`),
  `import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { BaseService } from '../../helper/crud/base.service'
import { paginate, type Pagination } from '../../helper/paginate'
import { applyTenantScope } from '../../shared/tenant/tenant-scope.util'
import { ${ModulePascal}Entity } from './entities/${moduleSnake}.entity'

@Injectable()
export class ${ModulePascal}Service extends BaseService<${ModulePascal}Entity> {
  constructor(
    @InjectRepository(${ModulePascal}Entity)
    repository: Repository<${ModulePascal}Entity>
  ) {
    super(repository, '${label}')
  }

  /** 分页列表：keyword${parsedFields.some(field => field.search) ? '（模糊）' : ''}${parsedFields.some(field => field.query) ? ' + 精确过滤' : ''} */
  async listByQuery(query: {
    page?: number
    pageSize?: number
    keyword?: string
${parsedFields.filter(field => field.query).map(field => `    ${pascal(field.name)[0].toLowerCase() + pascal(field.name).slice(1)}?: ${TYPE_MAP[field.type].ts}`).join('\n')}
  }): Promise<Pagination<${ModulePascal}Entity>> {
    const qb = this.repository.createQueryBuilder('${moduleCamel}').orderBy('${moduleCamel}.id', 'DESC')
    applyTenantScope(qb, '${moduleCamel}')
    qb.andWhere('${moduleCamel}.delFlag = 0')
    if (query.keyword) {
${searchConds || "      qb.andWhere('1 = 0') // 未配置 s 字段"}
    }
${queryConds}
    return paginate(qb, { page: query.page, pageSize: query.pageSize })
  }
}
`
)

// ---------- v1 controller ----------
writeIfAbsent(
  path.join(serverRoot, `src/modules/${moduleSnake}/${moduleSnake}.v1.controller.ts`),
  `import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../common/decorators/oper-log.decorator'
import { Perms } from '../../common/decorators/perms.decorator'
import { Create${ModulePascal}Dto, Update${ModulePascal}Dto } from './dto/${moduleSnake}.dto'
import { ${ModulePascal}Service } from './${moduleSnake}.service'

/** ${label} v1 接口：统一挂 /api/v1，按钮权限 ${permsPrefix}:* */
@ApiTags('${permsPascalLabel}')
@ApiBearerAuth('jwt')
@Controller('v1/${moduleSnake}s')
export class ${ModulePascal}V1Controller {
  constructor(private readonly ${moduleCamel}Service: ${ModulePascal}Service) {}

  @ApiOperation({ summary: '${label}分页', description: '需 ${permsPrefix}:list' })
  @Perms('${permsPrefix}:list')
  @Get()
  list(@Query() query: { page?: number; pageSize?: number; keyword?: string }) {
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
  @OperLog('${permsPascalLabel}')
  @Post()
  create(@Body() dto: Create${ModulePascal}Dto) {
    return this.${moduleCamel}Service.create(dto)
  }

  @ApiOperation({ summary: '修改${label}', description: '需 ${permsPrefix}:update' })
  @Perms('${permsPrefix}:update')
  @OperLog('${permsPascalLabel}')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: Update${ModulePascal}Dto) {
    return this.${moduleCamel}Service.update(id, dto)
  }

  @ApiOperation({ summary: '删除${label}', description: '需 ${permsPrefix}:delete' })
  @Perms('${permsPrefix}:delete')
  @OperLog('${permsPascalLabel}')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.${moduleCamel}Service.delete(id)
  }
}
`
)

// ---------- module ----------
writeIfAbsent(
  path.join(serverRoot, `src/modules/${moduleSnake}/${moduleSnake}.module.ts`),
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
    const base = `\`${field.name}\` ${typeMap.mysql}${field.required ? ' NOT NULL' : ' NULL'}${field.default !== undefined ? ` DEFAULT '${field.default}'` : field.required ? '' : ' DEFAULT NULL'} COMMENT '${field.comment}'`
    return base
  }),
  '`del_flag` tinyint NOT NULL DEFAULT 0 COMMENT \'0正常 1已删除\'',
  '`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)',
  '`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)'
].join(',\n        ')

writeIfAbsent(
  path.join(serverRoot, `src/migrations/${timestamp}-Gen${ModulePascal}.ts`),
  `import { type MigrationInterface, type QueryRunner } from 'typeorm'

/** 生成器产物：${label}表（${table}）+ 菜单节点 */
export class Gen${ModulePascal}${timestamp} implements MigrationInterface {
  name = 'Gen${ModulePascal}${timestamp}'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(\`
      CREATE TABLE IF NOT EXISTS \\\`${table}\\\` (
        ${migrationColumns.replace(/`/g, '\\`')},
        PRIMARY KEY (\\\`id\\\`),
        KEY \\\`idx_${table}_tenant\\\` (\\\`tenant_id\\\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='${label}'
    \`)
    // 菜单：挂「协同办公」下（demo 惯例）；真实业务模块可改 parent_id，或生成后在菜单管理里挪
    await queryRunner.query(\`
      INSERT IGNORE INTO \\\`sys_permission\\\` (\\\`id\\\`, \\\`parent_id\\\`, \\\`name\\\`, \\\`url\\\`, \\\`icon\\\`, \\\`menu_type\\\`, \\\`sort_no\\\`, \\\`status\\\`, \\\`del_flag\\\`, \\\`is_leaf\\\`, \\\`perms\\\`)
      VALUES
        ('menu_${moduleSnake}', 'menu_collab', '${label}管理', '/system/${moduleSnake}s', 'Briefcase', 1, 4, '1', 0, 0, '${permsPrefix}:list'),
        ('menu_${moduleSnake}_add', 'menu_${moduleSnake}', '新增${label}', NULL, NULL, 2, 1, '1', 0, 1, '${permsPrefix}:add'),
        ('menu_${moduleSnake}_edit', 'menu_${moduleSnake}', '编辑${label}', NULL, NULL, 2, 2, '1', 0, 1, '${permsPrefix}:update'),
        ('menu_${moduleSnake}_del', 'menu_${moduleSnake}', '删除${label}', NULL, NULL, 2, 3, '1', 0, 1, '${permsPrefix}:delete')
    \`)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DELETE FROM \\\`sys_role_permission\\\` WHERE \\\`permission_id\\\` IN (SELECT \\\`id\\\` FROM (SELECT \\\`id\\\` FROM \\\`sys_permission\\\` WHERE \\\`id\\\` LIKE 'menu_${moduleSnake}%') t)"
    )
    await queryRunner.query("DELETE FROM \\\`sys_permission\\\` WHERE \\\`id\\\` LIKE 'menu_${moduleSnake}%'")
    await queryRunner.query(\`DROP TABLE IF EXISTS \\\`${table}\\\`\`)
  }
}
`
)

// ---------- 前端 ----------
const feFields = parsedFields.map(field => ({
  ...field,
  tsName: pascal(field.name)[0].toLowerCase() + pascal(field.name).slice(1)
}))
const feApiFields = feFields.map(field => `  ${field.tsName}?: ${TYPE_MAP[field.type].ts} | null`).join('\n')

writeIfAbsent(
  path.join(adminRoot, `src/features/${moduleSnake}/api.ts`),
  `import { getApiResult } from '@/lib/http'

/** ${label}（生成器产物） */
export interface ${ModulePascal} {
  id: number
${feApiFields}
  createdAt: string
  updatedAt: string
}

export interface ${ModulePascal}ListResult {
  records: ${ModulePascal}[]
  total: number
  current: number
  size: number
  pages: number
}

export function fetch${ModulePascal}s(params: { page?: number; pageSize?: number; keyword?: string }) {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') qs.set(key, String(value))
  })
  return getApiResult<${ModulePascal}ListResult>(\`/backend-api/v1/${moduleSnake}s?\${qs.toString()}\`)
}

export function create${ModulePascal}(payload: Partial<${ModulePascal}>) {
  return getApiResult<${ModulePascal}>('/backend-api/v1/${moduleSnake}s', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
}

export function update${ModulePascal}(id: number, payload: Partial<${ModulePascal}>) {
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

const tableCells = feFields
  .map(field => `                  <td className="px-3 py-2 text-sm">{row.${field.tsName} ?? '-'}</td>`)
  .join('\n')

writeIfAbsent(
  path.join(adminRoot, `src/features/${moduleSnake}/index.tsx`),
  `import { useEffect, useState } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { hasPermission } from '@/lib/auth'
import {
  create${ModulePascal},
  delete${ModulePascal},
  fetch${ModulePascal}s,
  update${ModulePascal},
  type ${ModulePascal}
} from './api'

/** ${label}管理（生成器产物骨架：表格 + 新增/编辑/删除） */
export function ${ModulePascal}Page() {
  const [list, setList] = useState<${ModulePascal}[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [editing, setEditing] = useState<Partial<${ModulePascal}> | null>(null)
  const [deleting, setDeleting] = useState<${ModulePascal} | null>(null)
  const canAdd = hasPermission('${permsPrefix}:add')
  const canEdit = hasPermission('${permsPrefix}:update')
  const canDelete = hasPermission('${permsPrefix}:delete')

  const load = () => {
    setLoading(true)
    fetch${ModulePascal}s({ pageSize: 50, keyword: keyword || undefined })
      .then(res => setList(res.records ?? []))
      .catch(() => toast.error('加载失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-base">${label}管理</CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                className="w-48 pl-8"
                placeholder="搜索"
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && load()}
              />
            </div>
            {canAdd && (
              <Button size="sm" onClick={() => setEditing({})}>
                <Plus className="size-4" />
                新增
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
${feFields.map(field => `                    <th className="px-3 py-2 font-medium">${field.comment}</th>`).join('\n')}
                    <th className="w-24 px-3 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {list.map(row => (
                    <tr key={row.id} className="hover:bg-muted/40">
${tableCells}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          {canEdit && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditing(row)}>
                              编辑
                            </Button>
                          )}
                          {canDelete && (
                            <Button variant="ghost" size="icon" className="text-muted-foreground size-7" onClick={() => setDeleting(row)}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {list.length === 0 && (
                    <tr>
                      <td colSpan={${feFields.length + 1}} className="text-muted-foreground py-10 text-center text-sm">
                        暂无数据
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {editing !== null && (
        <${ModulePascal}FormDialog
          value={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={open => !open && setDeleting(null)}
        title="删除${label}"
        description={\`确定删除${label}「\${deleting?.${feFields[0]?.tsName ?? 'id'} ?? deleting?.id}」吗？该操作不可恢复。\`}
        onConfirm={async () => {
          if (!deleting) return
          try {
            await delete${ModulePascal}(deleting.id)
            toast.success('已删除')
            setDeleting(null)
            load()
          } catch (error) {
            toast.error(error instanceof Error ? error.message : '删除失败')
          }
        }}
      />
    </div>
  )
}

function ${ModulePascal}FormDialog({
  value,
  onClose,
  onSaved
}: {
  value: Partial<${ModulePascal}>
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<Partial<${ModulePascal}>>(value)
  const [busy, setBusy] = useState(false)
  const isEdit = typeof value.id === 'number'

  const submit = () => {
    setBusy(true)
    const request = isEdit ? update${ModulePascal}(value.id as number, form) : create${ModulePascal}(form)
    request
      .then(() => {
        toast.success(isEdit ? '已保存' : '已新增')
        onSaved()
      })
      .catch(error => toast.error(error instanceof Error ? error.message : '保存失败'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="bg-black/50 fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background w-full max-w-lg rounded-xl border p-5" onClick={e => e.stopPropagation()}>
        <h3 className="mb-4 text-base font-medium">{isEdit ? '编辑${label}' : '新增${label}'}</h3>
        <div className="space-y-3">
${feFields
  .map(
    field => `          <div className="space-y-1">
            <label className="text-muted-foreground text-xs">${field.comment}</label>
            <Input
              value={String(form.${field.tsName} ?? '')}
              onChange={e => setForm(prev => ({ ...prev, ${field.tsName}: ${
                ['int', 'bigint', 'tinyint', 'decimal'].includes(field.type) ? 'Number(e.target.value)' : 'e.target.value'
              } }))}
            />
          </div>`
  )
  .join('\n')}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
    </div>
  )
}
`
)

console.log(`
完成。接下来手动做两件事：
  1. 后端 src/app.module.ts 注册 ${ModulePascal}Module，然后 npm run build && npx typeorm migration:run
     （迁移已自动带上菜单节点 menu_${moduleSnake}（协同办公下）+ 三个按钮，跑完退出重登即可见）
  2. 前端 src/routes/_authenticated/system/${moduleSnake}.tsx 建 createFileRoute，page-registry 登记 '/system/${moduleSnake}s'，i18n 加 nav 键
`)
