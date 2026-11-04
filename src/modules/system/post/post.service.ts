import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { BaseService } from '../../../helper/crud/base.service'
import { DeptEntity } from '../dept/entities/dept.entity'
import { PostEntity } from './entities/post.entity'
import type { CreatePostDto } from './dto/create-post.dto'
import type { QueryPostDto } from './dto/query-post.dto'
import type { UpdatePostDto } from './dto/update-post.dto'

@Injectable()
export class PostService extends BaseService<PostEntity> {
  constructor(
    @InjectRepository(PostEntity)
    private readonly postRepository: Repository<PostEntity>
  ) {
    super(postRepository, '岗位')
  }

  /** 岗位列表（post_sort 升序，带所属部门），keyword 模糊匹配名称/编码/描述，可按 deptId 过滤 */
  async listByQuery(query: QueryPostDto): Promise<PostEntity[]> {
    const qb = this.postRepository.createQueryBuilder('post').leftJoinAndSelect('post.dept', 'dept').orderBy('post.post_sort', 'ASC')
    const keyword = query.keyword?.trim()
    if (keyword) {
      qb.where('post.post_name LIKE :kw OR post.post_code LIKE :kw OR post.description LIKE :kw', { kw: `%${keyword}%` })
    }
    if (query.deptId) {
      qb.andWhere('post.dept_id = :deptId', { deptId: query.deptId })
    }
    return qb.getMany()
  }

  /** 创建岗位：postCode 唯一（前置拦截可读报错）；deptId 传了必须存在 */
  async createPost(dto: CreatePostDto, operator?: string): Promise<PostEntity> {
    await this.assertCodeAvailable(dto.postCode)
    if (dto.deptId) {
      await this.assertDeptExists(dto.deptId)
    }
    return this.create({
      ...dto,
      createBy: operator,
      createTime: new Date()
    })
  }

  /** 更新岗位：改编码时校验唯一、换部门时校验部门存在 */
  async updatePost(id: string, dto: UpdatePostDto, operator?: string): Promise<PostEntity> {
    const before = await this.findOne(id)
    if (dto.postCode && dto.postCode !== before.postCode) {
      await this.assertCodeAvailable(dto.postCode)
    }
    if (dto.deptId) {
      await this.assertDeptExists(dto.deptId)
    }
    return this.update(id, { ...dto, updateBy: operator, updateTime: new Date() })
  }

  private async assertCodeAvailable(postCode: string): Promise<void> {
    const exists = await this.postRepository.findOne({ where: { postCode } })
    if (exists) {
      throw new BadRequestException(`岗位编码「${postCode}」已存在`)
    }
  }

  private async assertDeptExists(deptId: string): Promise<void> {
    const dept = await this.postRepository.manager.findOne(DeptEntity, { where: { id: deptId, delFlag: '0' } })
    if (!dept) {
      throw new BadRequestException('所属部门不存在或已删除')
    }
  }
}
