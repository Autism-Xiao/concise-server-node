import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'

import { BaseService } from '../../helper/crud/base.service'
import { parseCsv } from '../../utils/csv.util'
import { RoleEntity } from './entities/role.entity'
import { MenuEntity } from '../menu/entities/menu.entity'
import type { CreateRoleDto } from './dto/create-role.dto'
import type { QueryRoleDto } from './dto/query-role.dto'
import type { UpdateRoleDto } from './dto/update-role.dto'

/** 导入结果：逐行统计 + 失败明细（前端据此展示导入报告） */
export interface RoleImportResult {
  /** 参与解析的数据行数（不含表头、空行） */
  total: number
  created: number
  updated: number
  /** 跳过行数（编码重复于本文件内） */
  skipped: number
  failed: number
  errors: Array<{ row: number; roleCode: string; message: string }>
}

/** 导入单文件上限：2000 行、2MB，防止一次性灌爆内存 */
export const ROLE_IMPORT_MAX_ROWS = 2000
export const ROLE_IMPORT_MAX_SIZE = 2 * 1024 * 1024

/** 角色编码规则：字母开头，允许字母/数字/下划线/冒号/点/短横线，最长 100 */
const ROLE_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_:.-]*$/

@Injectable()
export class RoleService extends BaseService<RoleEntity> {
  constructor(
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>
  ) {
    super(roleRepository, '角色')
  }

  /** 角色列表（含已授权菜单），角色数量少不分页，keyword 模糊匹配名称/编码 */
  async listByQuery(query: QueryRoleDto): Promise<RoleEntity[]> {
    const roles = await this.roleRepository.find({ relations: { permissions: true }, order: { createTime: 'ASC' } })
    const keyword = query.keyword?.trim().toLowerCase()
    if (!keyword) {
      return roles
    }
    return roles.filter(role => (role.roleName ?? '').toLowerCase().includes(keyword) || (role.roleCode ?? '').toLowerCase().includes(keyword))
  }

  /** 创建角色，支持 menuIds 绑定菜单权限（id 由 BaseService 自动生成 32 位） */
  async createRole(dto: CreateRoleDto): Promise<RoleEntity> {
    await this.assertCodeAvailable(dto.roleCode)
    const role = await this.create({
      roleName: dto.roleName,
      roleCode: dto.roleCode,
      description: dto.description
    })
    if (dto.menuIds?.length) {
      await this.assignMenus(role.id, dto.menuIds)
    }
    return this.findOneWithMenus(role.id)
  }

  /** 更新角色基础信息，可同时传 menuIds 覆盖授权；内置 admin 角色编码不允许修改 */
  async updateRole(id: string, dto: UpdateRoleDto): Promise<RoleEntity> {
    const role = await this.findOne(id)
    if (dto.roleCode && dto.roleCode !== role.roleCode) {
      if (role.roleCode === 'admin') {
        throw new BadRequestException('内置管理员角色的编码不允许修改')
      }
      await this.assertCodeAvailable(dto.roleCode)
    }
    await this.roleRepository.update(id, { roleName: dto.roleName, roleCode: dto.roleCode, description: dto.description })
    if (dto.menuIds) {
      await this.assignMenus(id, dto.menuIds)
    }
    return this.findOneWithMenus(id)
  }

  /**
   * 删除角色（硬删）
   * 保护规则：内置 admin 角色不可删；角色下仍有用户时拒绝，需先解绑；
   * 删除前清理 sys_role_permission 关联行，避免外键约束残留
   */
  async deleteRole(id: string): Promise<void> {
    const role = await this.findOne(id)
    if (role.roleCode === 'admin') {
      throw new BadRequestException('内置管理员角色不允许删除')
    }
    const users = await this.roleRepository.createQueryBuilder().relation(RoleEntity, 'users').of(id).loadMany<{ id: string }>()
    if (users.length) {
      throw new BadRequestException(`该角色下还有 ${users.length} 个用户，请先解绑后再删除`)
    }
    const menus = await this.roleRepository.createQueryBuilder().relation(RoleEntity, 'permissions').of(id).loadMany<MenuEntity>()
    if (menus.length) {
      await this.roleRepository
        .createQueryBuilder()
        .relation(RoleEntity, 'permissions')
        .of(id)
        .remove(menus.map(menu => menu.id))
    }
    await this.roleRepository.delete(id)
  }

  /** 绑定菜单权限（全量覆盖：多退少补） */
  async assignMenus(id: string, menuIds: string[]): Promise<void> {
    await this.findOne(id)
    const menus = await this.roleRepository.manager.getRepository(MenuEntity).find({ where: { id: In(menuIds) } })
    if (menus.length !== menuIds.length) {
      throw new NotFoundException('存在无效的菜单 ID')
    }
    const nextIds = new Set(menuIds)
    const current = await this.roleRepository.createQueryBuilder().relation(RoleEntity, 'permissions').of(id).loadMany<MenuEntity>()
    const currentIds = new Set(current.map(menu => menu.id))
    // 只新增差集、删除差集，避免重复插入关联行
    const toAdd = menus.filter(menu => !currentIds.has(menu.id))
    const toRemove = current.filter(menu => !nextIds.has(menu.id))
    await this.roleRepository.createQueryBuilder().relation(RoleEntity, 'permissions').of(id).addAndRemove(toAdd, toRemove)
  }

  /** 查角色详情（含菜单权限） */
  async findOneWithMenus(id: string): Promise<RoleEntity> {
    const role = await this.roleRepository.findOne({ where: { id }, relations: { permissions: true } })
    if (!role) {
      throw new NotFoundException('角色不存在')
    }
    return role
  }

  /** 按 id 列表查角色 */
  async findByIds(ids: string[]): Promise<RoleEntity[]> {
    return this.roleRepository.findBy({ id: In(ids) })
  }

  /** 导出角色（与列表同过滤条件，全量不分页；角色数量少，不做上限截断） */
  async exportRoles(query: QueryRoleDto): Promise<RoleEntity[]> {
    return this.listByQuery(query)
  }

  /**
   * 从 CSV 文本导入角色（按 roleCode 判定新增或更新）
   * - 新增：roleName/roleCode/description 入库，不绑定菜单权限
   * - 已存在：只覆盖 roleName/description（不传 description 则保持原值），已有授权不受影响
   * - 单行失败不影响其他行，最终返回统计 + 失败明细
   */
  async importRoles(text: string): Promise<RoleImportResult> {
    // utf8 解码失败会产生替换字符，明确报错比入库乱码好排查
    if (text.includes('\uFFFD')) {
      throw new BadRequestException('文件编码不是 UTF-8，请用 Excel 另存为「CSV UTF-8（逗号分隔）」后重试')
    }
    const rows = parseCsv(text)
    if (!rows.length) {
      throw new BadRequestException('文件内容为空，请下载模板后填写')
    }

    const { columns, dataRows } = this.resolveImportColumns(rows)
    if (!columns.roleCode) {
      throw new BadRequestException('未找到「角色编码」列，请使用导入模板的表头')
    }
    if (dataRows.length > ROLE_IMPORT_MAX_ROWS) {
      throw new BadRequestException(`单次最多导入 ${ROLE_IMPORT_MAX_ROWS} 行，当前 ${dataRows.length} 行，请拆分后重试`)
    }

    const existing = await this.roleRepository.find()
    const existingByCode = new Map(existing.map(role => [role.roleCode, role]))
    /** 文件内已处理过的编码，重复行直接跳过（避免同一份文件里互相覆盖） */
    const seenCodes = new Set<string>()
    const result: RoleImportResult = { total: dataRows.length, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] }

    for (const { rowNumber, cells } of dataRows) {
      const roleCode = (cells[columns.roleCode] ?? '').trim()
      const roleName = columns.roleName === undefined ? '' : (cells[columns.roleName] ?? '').trim()
      const description = columns.description === undefined ? undefined : (cells[columns.description] ?? '').trim()

      const fail = (message: string) => {
        result.failed += 1
        result.errors.push({ row: rowNumber, roleCode, message })
      }

      if (!roleCode) {
        fail('角色编码不能为空')
        continue
      }
      if (roleCode.length > 100 || !ROLE_CODE_PATTERN.test(roleCode)) {
        fail('角色编码需字母开头，只能包含字母/数字/下划线/冒号/点/短横线，且不超过 100 个字符')
        continue
      }

      const current = existingByCode.get(roleCode)
      if (seenCodes.has(roleCode)) {
        result.skipped += 1
        result.errors.push({ row: rowNumber, roleCode, message: '文件内角色编码重复，本行已跳过' })
        continue
      }
      seenCodes.add(roleCode)
      try {
        if (current) {
          await this.roleRepository.update(current.id, {
            roleName: roleName || current.roleName,
            // 空白描述视为「未填写」，保留原值，避免导入把已有备注清空
            description: description === undefined || description === '' ? current.description : description
          })
          result.updated += 1
        } else {
          const created = await this.create({ roleName: roleName || roleCode, roleCode, description: description || undefined })
          existingByCode.set(roleCode, created)
          result.created += 1
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : '写入失败')
      }
    }

    return result
  }

  /** 解析导入文件的列位置：有表头按表头名定位，无表头按「角色名称,角色编码,描述」固定顺序 */
  private resolveImportColumns(rows: string[][]): {
    columns: { roleName?: number; roleCode?: number; description?: number }
    dataRows: Array<{ rowNumber: number; cells: string[] }>
  } {
    const aliases = {
      roleName: ['角色名称', '角色名', 'rolename', 'name'],
      roleCode: ['角色编码', '权限字符', 'rolecode', 'code'],
      description: ['描述', '备注', 'description', 'remark']
    }
    const header = rows[0].map(cell => cell.trim().toLowerCase())
    const pick = (keys: string[]) => {
      const index = header.findIndex(cell => keys.includes(cell))
      return index >= 0 ? index : undefined
    }
    const columns = { roleName: pick(aliases.roleName), roleCode: pick(aliases.roleCode), description: pick(aliases.description) }

    // 表头行必须至少命中一个已知列，否则视为无表头的数据文件（行号从 1 开始，方便用户对照 Excel）
    const hasHeader = columns.roleName !== undefined || columns.roleCode !== undefined || columns.description !== undefined
    if (hasHeader) {
      return { columns, dataRows: rows.slice(1).map((cells, index) => ({ rowNumber: index + 2, cells })) }
    }
    return {
      columns: { roleName: 0, roleCode: 1, description: 2 },
      dataRows: rows.map((cells, index) => ({ rowNumber: index + 1, cells }))
    }
  }

  /** 校验角色编码未被占用（数据库有唯一索引，提前拦截给出可读报错） */
  private async assertCodeAvailable(roleCode: string): Promise<void> {
    const exists = await this.roleRepository.findOne({ where: { roleCode } })
    if (exists) {
      throw new BadRequestException(`角色编码「${roleCode}」已存在`)
    }
  }
}
