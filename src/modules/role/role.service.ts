import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository, type EntityManager } from 'typeorm'

import { BaseService } from '../../helper/crud/base.service'
import { applyTenantScope } from '../../shared/tenant/tenant-scope.util'
import { PermissionCacheService } from '../../shared/permission-cache/permission-cache.service'
import { normalizeBatchIds, runBatchDelete, type BatchDeleteResult } from '../../helper/crud/batch-delete'
import { isSuperRole } from '../../utils/super-role.util'
import { randomId32 } from '../../utils/password.util'
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

/** 导入单文件上限：2000 行、5MB，防止一次性灌爆内存 */
export const ROLE_IMPORT_MAX_ROWS = 2000
export const ROLE_IMPORT_MAX_SIZE = 5 * 1024 * 1024

/** 角色编码规则：字母开头，允许字母/数字/下划线/冒号/点/短横线，最长 100 */
const ROLE_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_:.-]*$/

@Injectable()
export class RoleService extends BaseService<RoleEntity> {
  constructor(
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    private readonly permissionCache: PermissionCacheService
  ) {
    super(roleRepository, '角色')
  }

  /** 角色列表（含已授权菜单），角色数量少不分页，keyword 模糊匹配名称/编码 */
  async listByQuery(query: QueryRoleDto): Promise<RoleEntity[]> {
    const rolesQb = this.roleRepository.createQueryBuilder('role').leftJoinAndSelect('role.permissions', 'perm').orderBy('role.createTime', 'ASC')
    applyTenantScope(rolesQb, 'role')
    const roles = await rolesQb.getMany()
    const keyword = query.keyword?.trim().toLowerCase()
    if (!keyword) {
      return roles
    }
    return roles.filter(role => (role.roleName ?? '').toLowerCase().includes(keyword) || (role.roleCode ?? '').toLowerCase().includes(keyword))
  }

  /** 角色下拉选项：只暴露 id/名称/编码，供用户表单分配角色、列表筛选（登录即可用，不含授权明细） */
  async listOptions(): Promise<Array<{ id: string; roleCode: string; roleName?: string }>> {
    const qb = this.roleRepository.createQueryBuilder('role').select(['role.id', 'role.roleCode', 'role.roleName']).orderBy('role.createTime', 'ASC')
    applyTenantScope(qb, 'role')
    return qb.getMany()
  }

  /** 创建角色，支持 menuIds 绑定菜单权限（id 由 BaseService 自动生成 32 位） */
  async createRole(dto: CreateRoleDto): Promise<RoleEntity> {
    // 超管编码是内置约定，不允许新建同名角色（否则会静默继承全部权限）
    if (isSuperRole(dto.roleCode)) {
      throw new BadRequestException(`「${dto.roleCode}」是内置超级管理员角色编码，不允许创建`)
    }
    await this.assertCodeAvailable(dto.roleCode)
    // 角色本体与授权关系同一个事务：避免「角色建好了但菜单一条没绑」的半成品
    const roleId = await this.roleRepository.manager.transaction(async manager => {
      const repo = manager.getRepository(RoleEntity)
      const role = await repo.save(
        repo.create({
          // 主键是 varchar(32) 且无数据库默认值，必须显式生成（与 BaseService.create 行为一致）
          id: randomId32(),
          roleName: dto.roleName,
          roleCode: dto.roleCode,
          description: dto.description,
          dataScope: dto.dataScope ?? 1,
          createTime: new Date()
        })
      )
      if (dto.menuIds?.length) {
        await this.assignMenus(role.id, dto.menuIds, manager)
      }
      return role.id
    })
    return this.findOneWithMenus(roleId)
  }

  /** 更新角色基础信息，可同时传 menuIds 覆盖授权；内置超管角色的编码不允许修改 */
  async updateRole(id: string, dto: UpdateRoleDto): Promise<RoleEntity> {
    const role = await this.findOne(id)
    if (dto.roleCode && dto.roleCode !== role.roleCode) {
      if (isSuperRole(role.roleCode)) {
        throw new BadRequestException('内置管理员角色的编码不允许修改')
      }
      if (isSuperRole(dto.roleCode)) {
        throw new BadRequestException(`「${dto.roleCode}」是内置超级管理员角色编码，不允许占用`)
      }
      await this.assertCodeAvailable(dto.roleCode)
    }
    await this.roleRepository.manager.transaction(async manager => {
      await manager.getRepository(RoleEntity).update(id, {
        roleName: dto.roleName,
        roleCode: dto.roleCode,
        description: dto.description,
        // 数据范围只接受显式传入；undefined 表示本次不改（前端没传别把已有配置冲掉）
        ...(dto.dataScope !== undefined ? { dataScope: dto.dataScope } : {}),
        updateTime: new Date()
      })
      if (dto.menuIds) {
        await this.assignMenus(id, dto.menuIds, manager)
      }
    })
    return this.findOneWithMenus(id)
  }

  /**
   * 删除角色（硬删）
   * 保护规则：内置 admin 角色不可删；角色下仍有**未删除**用户时拒绝，需先解绑；
   * 删除前清理 sys_role_permission 关联行，避免外键约束残留
   *
   * 注意「仍有用户」的口径：只统计 del_flag = 0 的用户。
   * 之前用关联表条数判断，软删用户会一直占着 sys_user_role，导致角色永久删不掉而界面上又找不到那个用户。
   */
  async deleteRole(id: string): Promise<void> {
    const role = await this.findOne(id)
    if (isSuperRole(role.roleCode)) {
      throw new BadRequestException('内置管理员角色不允许删除')
    }
    const rows = (await this.roleRepository.query(
      'SELECT COUNT(*) AS total FROM sys_user_role ur INNER JOIN sys_user u ON u.id = ur.user_id WHERE ur.role_id = ? AND u.del_flag = 0',
      [id]
    )) as Array<{ total: number | string }>
    const activeUsers = Number(rows?.[0]?.total ?? 0)
    if (activeUsers > 0) {
      throw new BadRequestException(`该角色下还有 ${activeUsers} 个用户，请先解绑后再删除`)
    }
    await this.roleRepository.manager.transaction(async manager => {
      const repo = manager.getRepository(RoleEntity)
      // 历史软删用户可能仍残留关联行，一并清掉，避免外键拦路
      await manager.query('DELETE FROM sys_user_role WHERE role_id = ?', [id])
      const menus = await repo.createQueryBuilder().relation(RoleEntity, 'permissions').of(id).loadMany<MenuEntity>()
      if (menus.length) {
        await repo
          .createQueryBuilder()
          .relation(RoleEntity, 'permissions')
          .of(id)
          .remove(menus.map(menu => menu.id))
      }
      await repo.delete(id)
    })
    await this.permissionCache.invalidateRole(id)
  }

  /** 批量删除角色：逐条走 deleteRole，保留「内置角色 / 有用户不可删」的保护并收集原因 */
  async batchDelete(ids: string[]): Promise<BatchDeleteResult> {
    const targets = await this.roleRepository.findBy({ id: In(normalizeBatchIds(ids)) })
    return runBatchDelete(
      targets,
      {
        getId: role => role.id,
        getName: role => role.roleName,
        remove: role => this.deleteRole(role.id)
      },
      ids
    )
  }

  /**
   * 绑定菜单权限（全量覆盖：多退少补）
   *
   * 超管角色直接拒绝：其权限来自内置规则（不读关联表），写入既不生效又会产生误导数据。
   */
  async assignMenus(id: string, menuIds: string[], manager?: EntityManager): Promise<void> {
    // 有事务时必须用事务内的仓库：刚插入的角色在别的连接上还看不到，用默认连接校验会误判「角色不存在」
    const roleRepo = manager ? manager.getRepository(RoleEntity) : this.roleRepository
    const role = await roleRepo.findOne({ where: { id } })
    if (!role) {
      throw new NotFoundException('角色不存在')
    }
    if (isSuperRole(role.roleCode)) {
      throw new BadRequestException('内置超级管理员拥有全部权限，无需也不允许分配，修改不会生效')
    }
    const menus = await (manager ?? this.roleRepository.manager).getRepository(MenuEntity).find({ where: { id: In(menuIds) } })
    if (menus.length !== menuIds.length) {
      throw new NotFoundException('存在无效的菜单 ID')
    }
    const nextIds = new Set(menuIds)
    const current = await roleRepo.createQueryBuilder().relation(RoleEntity, 'permissions').of(id).loadMany<MenuEntity>()
    const currentIds = new Set(current.map(menu => menu.id))
    // 只新增差集、删除差集，避免重复插入关联行
    const toAdd = menus.filter(menu => !currentIds.has(menu.id))
    const toRemove = current.filter(menu => !nextIds.has(menu.id))
    await roleRepo.createQueryBuilder().relation(RoleEntity, 'permissions').of(id).addAndRemove(toAdd, toRemove)

    // 授权变了：该角色的权限集合缓存立即失效，保证「改完马上生效」
    // 事务内调用也安全：即使外层回滚，缓存只是被删掉，下次请求回源自愈
    await this.permissionCache.invalidateRole(id)
  }

  /** 查角色详情（含菜单权限） */
  async findOneWithMenus(id: string): Promise<RoleEntity> {
    const role = await this.roleRepository.findOne({ where: { id }, relations: { permissions: true } })
    if (!role) {
      throw new NotFoundException('角色不存在')
    }
    return role
  }

  /**
   * 角色已授权的菜单/按钮 id 列表（授权弹窗回显）
   *
   * 超管角色返回**全部**菜单 id：其真实权限就是全量（内置规则），
   * 若按关联表返回「几条脏数据」，前端会显示「已授权 2 项」这种与实际不符的信息。
   */
  async getMenuIds(id: string): Promise<string[]> {
    const role = await this.findOne(id)
    if (isSuperRole(role.roleCode)) {
      // 只回显未删除的菜单（与菜单树同源，已软删的节点在树上不存在，回显了也勾不上）
      const menus = await this.roleRepository.manager.getRepository(MenuEntity).find({ select: { id: true }, where: { delFlag: 0 } })
      return menus.map(menu => menu.id)
    }
    const detail = await this.findOneWithMenus(id)
    return (detail.permissions ?? []).map(menu => menu.id)
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
   * 导入角色（入参为已解析的二维表格数据，xlsx/csv 由 controller 负责解析）
   * - 新增：roleName/roleCode/description 入库，不绑定菜单权限
   * - 已存在：只覆盖 roleName/description（不传 description 则保持原值），已有授权不受影响
   * - 单行失败不影响其他行，最终返回统计 + 失败明细
   * - headerRowNumber：表头在 Excel 中的真实行号，用于把「第几行出错」报准
   */
  async importRoles(rows: string[][], headerRowNumber = 1): Promise<RoleImportResult> {
    if (!rows.length) {
      throw new BadRequestException('文件内容为空，请下载模板后填写')
    }

    const { columns, dataRows } = this.resolveImportColumns(rows, headerRowNumber)
    if (!columns.roleCode) {
      throw new BadRequestException('未找到「角色编码」列，请使用导入模板的表头')
    }
    if (!dataRows.length) {
      throw new BadRequestException('表头下方没有数据行，请填写后再导入')
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
          const created = await this.create({ roleName: roleName || roleCode, roleCode, description: description || undefined, createTime: new Date() })
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
  private resolveImportColumns(
    rows: string[][],
    headerRowNumber = 1
  ): {
    columns: { roleName?: number; roleCode?: number; description?: number }
    dataRows: Array<{ rowNumber: number; cells: string[] }>
  } {
    const aliases = {
      roleName: ['角色名称', '角色名', 'rolename', 'name'],
      roleCode: ['角色编码', '权限字符', 'rolecode', 'code'],
      description: ['描述', '备注', 'description', 'remark']
    }
    // 表头可能带必填标记（「角色编码 *」）或前后空格，归一化后比较
    const header = rows[0].map(cell => cell.replace(/[\s*＊]/g, '').toLowerCase())
    const pick = (keys: string[]) => {
      const index = header.findIndex(cell => keys.includes(cell))
      return index >= 0 ? index : undefined
    }
    const columns = { roleName: pick(aliases.roleName), roleCode: pick(aliases.roleCode), description: pick(aliases.description) }

    // 表头行必须至少命中一个已知列，否则视为无表头的数据文件（行号取 Excel 真实行号，方便用户对照定位）
    const hasHeader = columns.roleName !== undefined || columns.roleCode !== undefined || columns.description !== undefined
    if (hasHeader) {
      return { columns, dataRows: rows.slice(1).map((cells, index) => ({ rowNumber: headerRowNumber + index + 1, cells })) }
    }
    return {
      columns: { roleName: 0, roleCode: 1, description: 2 },
      dataRows: rows.map((cells, index) => ({ rowNumber: headerRowNumber + index, cells }))
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
