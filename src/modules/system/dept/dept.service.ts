import { Injectable, BadRequestException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository, type DeepPartial } from 'typeorm'

import { BaseService } from '../../../helper/crud/base.service'
import { applyTenantScope } from '../../../shared/tenant/tenant-scope.util'
import { normalizeBatchIds, runBatchDelete, type BatchDeleteResult } from '../../../helper/crud/batch-delete'
import { UserEntity } from '../../user/entities/user.entity'
import { DeptEntity } from './entities/dept.entity'
import type { CreateDeptDto } from './dto/create-dept.dto'

export interface DeptTreeItem extends DeptEntity {
  children: DeptTreeItem[]
}

/** 顶级部门的 parent_id 约定（JeecgBoot 用 null 或空串） */
function isRootParent(parentId?: string | null): boolean {
  return parentId === null || parentId === undefined || parentId === ''
}

@Injectable()
export class DeptService extends BaseService<DeptEntity> {
  constructor(
    @InjectRepository(DeptEntity)
    repository: Repository<DeptEntity>
  ) {
    super(repository, '部门')
  }

  /** 创建：校验父级存在、自动生成 orgCode */
  async create(dto: CreateDeptDto): Promise<DeptEntity> {
    const parentId = dto.parentId || null
    if (parentId) {
      await this.findOne(parentId)
    }
    const orgCode = dto.orgCode || (await this.generateOrgCode(parentId))
    // 手工指定编码时前置查重（org_code 唯一索引，撞了会 500，这里转 400 人话）
    if (dto.orgCode && (await this.repository.count({ where: { orgCode } })) > 0) {
      throw new BadRequestException(`部门编码「${orgCode}」已被占用`)
    }
    return super.create({
      ...dto,
      parentId,
      orgCode,
      status: dto.status ?? '1',
      delFlag: '0',
      orgCategory: dto.orgCategory ?? '2',
      createTime: new Date()
    })
  }

  /** 更新：父级不能指向自己或自己的后代（防环）；改父级时同步重算 orgCode */
  async update(id: string, dto: DeepPartial<DeptEntity>): Promise<DeptEntity> {
    const before = await this.findOne(id)
    // 手工改编码时前置查重（排除自身），避免撞唯一索引变 500
    if (dto.orgCode && dto.orgCode !== before.orgCode && (await this.repository.count({ where: { orgCode: dto.orgCode } })) > 0) {
      throw new BadRequestException(`部门编码「${dto.orgCode}」已被占用`)
    }
    if (dto.parentId !== undefined) {
      const parentId = dto.parentId || null
      if (parentId === id) {
        throw new BadRequestException('父级部门不能是自身')
      }
      if (parentId) {
        await this.findOne(parentId)
        const all = await this.repository.find()
        const descendantIds = this.collectDescendantIds(all, id)
        if (descendantIds.has(parentId)) {
          throw new BadRequestException('父级部门不能是自己的下级')
        }
      }
      dto.parentId = parentId
      // 只有父级真的变了才重算编码：同父级内拖拽排序也带 parentId，不能把手编的编码（如 NANSHAN）冲掉
      if (!dto.orgCode && (dto.parentId || null) !== (before.parentId || null)) {
        dto.orgCode = await this.generateOrgCode(parentId)
      }
    }
    dto.updateTime = new Date()
    const updated = await super.update(id, dto)
    // 机构编码变了，把挂了该部门的用户 sys_user.org_code 一并刷新（上面存的是冗余值）
    if (updated.orgCode && updated.orgCode !== before.orgCode) {
      await this.repository.manager.query('UPDATE `sys_user` u JOIN `sys_user_depart` ud ON ud.`user_id` = u.`id` SET u.`org_code` = ? WHERE ud.`dep_id` = ?', [
        updated.orgCode,
        id
      ])
    }
    return updated
  }

  /** 删除：有下级或挂了（未删除的）用户时不允许删（软删，置 del_flag='1'） */
  async delete(id: string): Promise<void> {
    await this.findOne(id)
    const childCount = await this.repository.count({ where: { parentId: id, delFlag: '0' } })
    if (childCount > 0) {
      throw new BadRequestException('该部门下存在子部门，无法删除')
    }
    // 走 sys_user_depart 关联表统计，并排除已软删用户（否则删过的人会一直挡住部门删除）
    const userCount = await this.repository.manager
      .createQueryBuilder(UserEntity, 'user')
      .innerJoin('user.depts', 'dept', 'dept.id = :deptId', { deptId: id })
      .where('user.del_flag = 0')
      .getCount()
    if (userCount > 0) {
      throw new BadRequestException('该部门下存在用户，无法删除')
    }
    await this.repository.update(id, { delFlag: '1' })
  }

  /** 批量删除部门：逐条走 delete，保留「有子部门 / 有用户不可删」的保护并收集原因 */
  async batchDelete(ids: string[]): Promise<BatchDeleteResult> {
    const targets = await this.repository.find({ where: { id: In(normalizeBatchIds(ids)), delFlag: '0' } })
    return runBatchDelete(
      targets,
      {
        getId: dept => dept.id,
        getName: dept => dept.departName,
        remove: dept => this.delete(dept.id)
      },
      ids
    )
  }

  /**
   * 导出：在扁平列表上补「完整路径」（研发部 / 前端组），方便直接看懂层级
   * 路径用父链上溯拼接，带 20 层保护，异常脏数据不会死循环
   */
  async exportDepts(keyword?: string): Promise<Array<DeptEntity & { fullPath: string }>> {
    const all = await this.listAll()
    const byId = new Map(all.map(dept => [dept.id, dept]))
    const resolvePath = (dept: DeptEntity): string => {
      const names: string[] = []
      let current: DeptEntity | undefined = dept
      let depth = 0
      while (current && depth < 20) {
        names.unshift(current.departName)
        current = current.parentId ? byId.get(current.parentId) : undefined
        depth += 1
      }
      return names.join(' / ')
    }
    const filtered = keyword ? all.filter(dept => (dept.departName ?? '').includes(keyword)) : all
    return filtered.map(dept => Object.assign(dept, { fullPath: resolvePath(dept) }))
  }

  /** 全量部门（按 depart_order 升序，排除已删除） */
  async listAll(): Promise<DeptEntity[]> {
    const qb = this.repository.createQueryBuilder('d').where('d.delFlag = :delFlag', { delFlag: '0' })
    applyTenantScope(qb, 'd')
    return qb.orderBy('d.departOrder', 'ASC').addOrderBy('d.id', 'ASC').getMany()
  }

  /** 扁平列表转树（parent_id 为 null/'' 视为顶级） */
  async getTree(): Promise<DeptTreeItem[]> {
    const all = await this.listAll()
    return buildDeptTree(all, null)
  }

  /** 顶级部门 */
  async listRoots(): Promise<DeptEntity[]> {
    const qb = this.repository.createQueryBuilder('d').where('d.parentId IS NULL').andWhere('d.delFlag = :delFlag', { delFlag: '0' })
    applyTenantScope(qb, 'd')
    return qb.orderBy('d.departOrder', 'ASC').getMany()
  }

  /**
   * 生成机构编码，JeecgBoot 风格两位字母递增：
   * - 顶级：A01、A02 ...
   * - 子级：父编码 + A01（如 A01A01）
   */
  private async generateOrgCode(parentId: string | null): Promise<string> {
    const siblingsQb = this.repository.createQueryBuilder('d')
    if (parentId) siblingsQb.where('d.parentId = :parentId', { parentId })
    else siblingsQb.where('d.parentId IS NULL')
    applyTenantScope(siblingsQb, 'd')
    const siblings = await siblingsQb.getMany()
    let prefix = 'A'
    if (parentId) {
      const parent = await this.repository.findOne({ where: { id: parentId } })
      if (!parent) {
        throw new BadRequestException('父级部门不存在')
      }
      prefix = parent.orgCode
    }
    let index = siblings.length + 1
    let code = `${prefix}A${String(index).padStart(2, '0')}`
    while ((await this.repository.count({ where: { orgCode: code } })) > 0) {
      index++
      code = `${prefix}A${String(index).padStart(2, '0')}`
    }
    return code
  }

  /** 收集某部门所有后代 id */
  private collectDescendantIds(all: DeptEntity[], rootId: string): Set<string> {
    const result = new Set<string>()
    const walk = (parentId: string) => {
      for (const dept of all) {
        if (dept.parentId === parentId && !result.has(dept.id)) {
          result.add(dept.id)
          walk(dept.id)
        }
      }
    }
    walk(rootId)
    return result
  }
}

/** list-to-tree：一次取全量后内存组装，不递归查库 */
export function buildDeptTree(all: DeptEntity[], parentId: string | null): DeptTreeItem[] {
  return all
    .filter(dept => (parentId === null ? isRootParent(dept.parentId) : dept.parentId === parentId))
    .map(dept =>
      // 实体实例展开为 plain object 组树（响应走 JSON 序列化，无原型丢失问题）
      // oxlint-disable-next-line typescript(no-misused-spread)
      ({
        ...dept,
        children: buildDeptTree(all, dept.id)
      })
    )
}
