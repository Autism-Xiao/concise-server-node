import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { BaseService } from '../../helper/crud/base.service'
import { paginate, type Pagination } from '../../helper/paginate'
import { applyTenantScope } from '../../shared/tenant/tenant-scope.util'
import { SupplierEntity } from './entities/supplier.entity'

@Injectable()
export class SupplierService extends BaseService<SupplierEntity> {
  constructor(
    @InjectRepository(SupplierEntity)
    repository: Repository<SupplierEntity>
  ) {
    super(repository, '供应商')
  }

  /** 分页列表：keyword（模糊） + 精确过滤 */
  async listByQuery(query: { page?: number; pageSize?: number; keyword?: string; name?: string }): Promise<Pagination<SupplierEntity>> {
    const qb = this.repository.createQueryBuilder('supplier').orderBy('supplier.id', 'DESC')
    applyTenantScope(qb, 'supplier')
    qb.andWhere('supplier.delFlag = 0')
    if (query.keyword) {
      qb.andWhere('supplier.name LIKE :keyword', { keyword: `%${query.keyword}%` })
    }
    if (query.name !== undefined && query.name !== null) {
      qb.andWhere('supplier.name = :name', { name: query.name })
    }
    return paginate(qb, { page: query.page, pageSize: query.pageSize })
  }
}
