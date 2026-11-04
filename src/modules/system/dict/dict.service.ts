import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { BaseService } from '../../../helper/crud/base.service'
import { SysDictEntity } from './entities/sys-dict.entity'
import { SysDictItemEntity } from './entities/sys-dict-item.entity'
import type { CreateDictDto } from './dto/create-dict.dto'
import type { QueryDictDto } from './dto/query-dict.dto'
import type { UpdateDictDto } from './dto/update-dict.dto'

@Injectable()
export class DictService extends BaseService<SysDictEntity> {
  constructor(
    @InjectRepository(SysDictEntity)
    private readonly dictRepository: Repository<SysDictEntity>
  ) {
    super(dictRepository, '字典')
  }

  /** 字典列表：字典类型数量少，一次全量返回（不分页），并带上每个字典的字典项数量 */
  async listByQuery(query: QueryDictDto): Promise<SysDictEntity[]> {
    const qb = this.dictRepository.createQueryBuilder('dict').where('dict.del_flag = 0').orderBy('dict.create_time', 'DESC').addOrderBy('dict.id', 'DESC')

    const keyword = query.keyword?.trim()
    if (keyword) {
      qb.andWhere('(dict.dict_name LIKE :keyword OR dict.dict_code LIKE :keyword)', { keyword: `%${keyword}%` })
    }

    const list = await qb.getMany()
    if (!list.length) return list

    const counts = await this.dictRepository.manager
      .createQueryBuilder(SysDictItemEntity, 'item')
      .select('item.dict_id', 'dictId')
      .addSelect('COUNT(*)', 'count')
      .where('item.dict_id IN (:...ids)', { ids: list.map(dict => dict.id) })
      .groupBy('item.dict_id')
      .getRawMany<{ dictId: string; count: string }>()

    const countMap = new Map(counts.map(row => [row.dictId, Number(row.count)]))
    return list.map(dict => Object.assign(dict, { itemCount: countMap.get(dict.id) ?? 0 }))
  }

  /** 字典详情（排除已删除） */
  async findDetail(id: string): Promise<SysDictEntity> {
    return this.findActive(id)
  }

  /** 创建字典：编码全局唯一（软删的记录仍占唯一索引，所以不带 del_flag 条件） */
  async createDict(dto: CreateDictDto, operator?: string): Promise<SysDictEntity> {
    await this.assertCodeAvailable(dto.dictCode)
    return this.create({
      dictName: dto.dictName,
      dictCode: dto.dictCode,
      type: dto.type ?? 0,
      description: dto.description,
      delFlag: 0,
      createBy: operator,
      createTime: new Date()
    })
  }

  /** 更新字典：改编码时重新校验唯一性；用 QueryBuilder 以便把 description 清空为 null */
  async updateDict(id: string, dto: UpdateDictDto, operator?: string): Promise<SysDictEntity> {
    await this.findActive(id)
    if (dto.dictCode) {
      await this.assertCodeAvailable(dto.dictCode, id)
    }

    const patch: Record<string, unknown> = {}
    if (dto.dictName !== undefined) patch.dictName = dto.dictName
    if (dto.dictCode !== undefined) patch.dictCode = dto.dictCode
    if (dto.type !== undefined) patch.type = dto.type
    if (dto.description !== undefined) patch.description = dto.description || null
    patch.updateBy = operator ?? null
    patch.updateTime = new Date()

    await this.dictRepository.createQueryBuilder().update(SysDictEntity).set(patch).where('id = :id', { id }).execute()
    return this.findActive(id)
  }

  /** 删除字典：软删（JeecgBoot 的 del_flag=1）；字典下还有字典项时拒绝 */
  async deleteDict(id: string): Promise<void> {
    await this.findActive(id)
    const itemCount = await this.dictRepository.manager.count(SysDictItemEntity, { where: { dictId: id } })
    if (itemCount > 0) {
      throw new BadRequestException(`该字典下存在 ${itemCount} 个字典项，请先删除字典项`)
    }
    await this.dictRepository.createQueryBuilder().update(SysDictEntity).set({ delFlag: 1, updateTime: new Date() }).where('id = :id', { id }).execute()
  }

  /** 取未删除的字典，不存在抛 404 */
  private async findActive(id: string): Promise<SysDictEntity> {
    const dict = await this.dictRepository.findOne({ where: { id, delFlag: 0 } })
    if (!dict) {
      throw new NotFoundException('字典不存在')
    }
    return dict
  }

  /** 字典编码唯一校验 */
  private async assertCodeAvailable(dictCode: string, excludeId?: string): Promise<void> {
    const qb = this.dictRepository.createQueryBuilder('dict').where('dict.dict_code = :dictCode', { dictCode })
    if (excludeId) {
      qb.andWhere('dict.id <> :excludeId', { excludeId })
    }
    if (await qb.getExists()) {
      throw new BadRequestException(`字典编码「${dictCode}」已存在`)
    }
  }
}
