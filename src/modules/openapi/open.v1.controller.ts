import { Controller, Get, Param, Query, Request } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'

import { ApiScope } from '../../common/decorators/api-scope.decorator'
import type { AppTokenUser } from '../../common/guards/api-scope.guard'
import { Pagination } from '../../helper/paginate'
import { UserEntity } from '../user/entities/user.entity'

/**
 * 开放接口（/api/v1/open/**）
 *
 * 给应用令牌（client_credentials）用的接口，与用户侧接口完全隔离：
 *  - scope 用 @ApiScope 声明（ApiScopeGuard 校验），不走 @Perms；
 *  - 返回字段白名单手挑 —— 用户侧接口的完整字段里有些（orgCode / tenantId / 加密字段）
 *    不该透给第三方，宁可这里写死也别复用 stripPassword 一把梭。
 * 新增开放接口：在这个控制器里加方法 + @ApiScope + 手写字段白名单。
 */
@ApiTags('开放平台')
@ApiBearerAuth('jwt')
@Controller('v1/open')
export class OpenV1Controller {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>
  ) {}

  /** 应用令牌可见的用户字段（白名单，不透传内部字段） */
  private pickUsers(rows: UserEntity[]) {
    return rows.map(row => ({
      id: row.id,
      username: row.username,
      realname: row.realname ?? null,
      email: row.email ?? null,
      status: row.status,
      createTime: row.createTime
    }))
  }

  /**
   * 应用租户过滤：tenantId > 0 的应用只看得到本租户用户；tenantId = 0（平台应用）可见全平台。
   * 之前两个接口都不带租户条件 —— 租户 A 的应用能拉到租户 B 的用户（含姓名/邮箱）。
   */
  private applyAppTenantScope(qb: ReturnType<Repository<UserEntity>['createQueryBuilder']>, tenantId: number): void {
    if (tenantId > 0) {
      qb.andWhere('u.tenant_id = :tenantId', { tenantId })
    }
  }

  @ApiOperation({ summary: '用户分页列表（应用令牌）', description: '需要 scope user:read；按应用归属租户过滤，只返回白名单字段' })
  @ApiScope('user:read')
  @Get('users')
  async listUsers(@Request() req: { user: AppTokenUser }, @Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    const qb = this.userRepo.createQueryBuilder('u').where('u.del_flag = :del', { del: '0' }).orderBy('u.create_time', 'DESC')
    this.applyAppTenantScope(qb, Number(req.user?.tenantId ?? 0))
    const total = await qb.getCount()
    const p = Math.max(1, Math.trunc(Number(page) || 1))
    const size = Math.min(100, Math.max(1, Math.trunc(Number(pageSize) || 20)))
    const rows = await qb
      .skip((p - 1) * size)
      .take(size)
      .getMany()
    return new Pagination(this.pickUsers(rows), total, p, size)
  }

  @ApiOperation({ summary: '用户详情（应用令牌）', description: '需要 scope user:read；只能查应用归属租户（或平台）内的用户' })
  @ApiScope('user:read')
  @Get('users/:id')
  async getUser(@Request() req: { user: AppTokenUser }, @Param('id') id: string) {
    const qb = this.userRepo.createQueryBuilder('u').where('u.id = :id', { id }).andWhere('u.del_flag = :del', { del: '0' })
    this.applyAppTenantScope(qb, Number(req.user?.tenantId ?? 0))
    const row = await qb.getOne()
    if (!row) return null
    return this.pickUsers([row])[0]
  }
}
