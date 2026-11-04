import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { BaseService } from '../../../helper/crud/base.service'
import { LevelEntity } from './entities/level.entity'
import type { CreateLevelDto } from './dto/create-level.dto'
import type { QueryLevelDto } from './dto/query-level.dto'
import type { UpdateLevelDto } from './dto/update-level.dto'

@Injectable()
export class LevelService extends BaseService<LevelEntity> {
  constructor(
    @InjectRepository(LevelEntity)
    private readonly levelRepository: Repository<LevelEntity>
  ) {
    super(levelRepository, '职级')
  }

  /** 职级列表（level_rank 降序=级别从高到低），keyword 模糊匹配名称/备注 */
  async listByQuery(query: QueryLevelDto): Promise<LevelEntity[]> {
    const qb = this.levelRepository.createQueryBuilder('level').orderBy('level.level_rank', 'DESC')
    const keyword = query.keyword?.trim()
    if (keyword) {
      qb.where('level.level_name LIKE :kw OR level.remark LIKE :kw', { kw: `%${keyword}%` })
    }
    return qb.getMany()
  }

  /** 创建职级：level_name 唯一（数据库唯一索引兜底，前置拦截给可读报错） */
  async createLevel(dto: CreateLevelDto, operator?: string): Promise<LevelEntity> {
    await this.assertNameAvailable(dto.levelName)
    return this.create({
      ...dto,
      createBy: operator,
      createTime: new Date()
    })
  }

  /** 更新职级：改名时校验唯一 */
  async updateLevel(id: string, dto: UpdateLevelDto, operator?: string): Promise<LevelEntity> {
    const before = await this.findOne(id)
    if (dto.levelName && dto.levelName !== before.levelName) {
      await this.assertNameAvailable(dto.levelName)
    }
    return this.update(id, { ...dto, updateBy: operator, updateTime: new Date() })
  }

  private async assertNameAvailable(levelName: string): Promise<void> {
    const exists = await this.levelRepository.findOne({ where: { levelName } })
    if (exists) {
      throw new BadRequestException(`职级「${levelName}」已存在`)
    }
  }
}
