import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import * as bcrypt from 'bcryptjs'

import { BaseService } from '../../helper/crud/base.service'
import { paginate, type PaginateOptions, type Pagination } from '../../helper/paginate'
import { UserEntity } from './entities/user.entity'
import type { QueryUserDto } from './dto/query-user.dto'

@Injectable()
export class UserService extends BaseService<UserEntity> {
  constructor(
    @InjectRepository(UserEntity)
    repository: Repository<UserEntity>
  ) {
    super(repository, '用户')
  }

  /** 创建：密码自动 bcrypt 哈希后入库 */
  async create(dto: Partial<UserEntity>): Promise<UserEntity> {
    const data = { ...dto }
    if (data.password) {
      data.password = await bcrypt.hash(data.password, 10)
    }
    return super.create(data)
  }

  /** 更新：若携带密码同样先哈希 */
  async update(id: number, dto: Partial<UserEntity>): Promise<UserEntity> {
    const data = { ...dto }
    if (data.password) {
      data.password = await bcrypt.hash(data.password, 10)
    }
    return super.update(id, data)
  }

  /** 分页列表：支持 keyword 模糊搜索用户名/昵称、status 精确过滤 */
  async listByQuery(query: QueryUserDto): Promise<Pagination<UserEntity>> {
    const qb = this.repository.createQueryBuilder('user').orderBy('user.id', 'DESC')

    if (query.keyword) {
      qb.andWhere('(user.username LIKE :keyword OR user.nickname LIKE :keyword)', {
        keyword: `%${query.keyword}%`
      })
    }
    if (query.status !== undefined && query.status !== '') {
      qb.andWhere('user.status = :status', { status: Number(query.status) })
    }

    const options: PaginateOptions = { page: query.page, pageSize: query.pageSize }
    return paginate(qb, options)
  }

  /** 按 id 查找（含密码，仅供认证场景使用） */
  async findOneWithPassword(id: number): Promise<UserEntity | null> {
    return this.repository.createQueryBuilder('user').addSelect('user.password').where('user.id = :id', { id }).getOne()
  }

  /** 按用户名查找（登录用） */
  async findByUsername(username: string): Promise<UserEntity | null> {
    return this.repository.createQueryBuilder('user').addSelect('user.password').where('user.username = :username', { username }).getOne()
  }

  /** 去掉密码字段，安全返回 */
  stripPassword(user: UserEntity): Omit<UserEntity, 'password'> {
    const { password: _password, ...rest } = user
    void _password
    return rest
  }
}
