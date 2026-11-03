import { Injectable, BadRequestException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { BaseService } from '../../../helper/crud/base.service'
import { UserEntity } from '../../user/entities/user.entity'
import { DeptEntity } from './entities/dept.entity'
import type { CreateDeptDto } from './dto/create-dept.dto'

export interface DeptTreeItem extends DeptEntity {
  children: DeptTreeItem[]
}

@Injectable()
export class DeptService extends BaseService<DeptEntity> {
  constructor(
    @InjectRepository(DeptEntity)
    repository: Repository<DeptEntity>
  ) {
    super(repository, '部门')
  }

  /** 创建：校验父级存在（0 为顶级） */
  async create(dto: CreateDeptDto): Promise<DeptEntity> {
    if (dto.parentId !== 0) {
      await this.findOne(dto.parentId)
    }
    return super.create(dto)
  }

  /** 更新：父级不能指向自己或自己的后代（防环） */
  async update(id: number, dto: Partial<DeptEntity>): Promise<DeptEntity> {
    if (dto.parentId !== undefined) {
      if (dto.parentId === id) {
        throw new BadRequestException('父级部门不能是自身')
      }
      if (dto.parentId !== 0) {
        await this.findOne(dto.parentId)
        const all = await this.repository.find()
        const descendantIds = this.collectDescendantIds(all, id)
        if (descendantIds.has(dto.parentId)) {
          throw new BadRequestException('父级部门不能是自己的下级')
        }
      }
    }
    return super.update(id, dto)
  }

  /** 删除：有下级或挂了用户时不允许删 */
  async delete(id: number): Promise<void> {
    await this.findOne(id)
    const childCount = await this.repository.count({ where: { parentId: id } })
    if (childCount > 0) {
      throw new BadRequestException('该部门下存在子部门，无法删除')
    }
    const userCount = await this.repository.manager.count(UserEntity, { where: { deptId: id } })
    if (userCount > 0) {
      throw new BadRequestException('该部门下存在用户，无法删除')
    }
    await super.delete(id)
  }

  /** 全量部门（按 sort 升序） */
  async listAll(): Promise<DeptEntity[]> {
    return this.repository.find({ order: { sort: 'ASC', id: 'ASC' } })
  }

  /** 扁平列表转树（parentId = 0 为顶级） */
  async getTree(): Promise<DeptTreeItem[]> {
    const all = await this.listAll()
    return buildDeptTree(all, 0)
  }

  /** 收集某部门所有后代 id */
  private collectDescendantIds(all: DeptEntity[], rootId: number): Set<number> {
    const result = new Set<number>()
    const walk = (parentId: number) => {
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
export function buildDeptTree(all: DeptEntity[], parentId: number): DeptTreeItem[] {
  return all
    .filter(dept => dept.parentId === parentId)
    .map(dept => ({
      ...dept,
      children: buildDeptTree(all, dept.id)
    }))
}
