import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * 用户-租户关系（对齐 JeecgBoot sys_user_tenant）
 *
 * 一个账号可属于多个租户：登录后用 `X-Tenant-Id` 请求头切换「当前租户」，
 * 服务端在中间件里校验成员关系（不信任前端传来的任意 id）。
 * status 为 1 表示该用户在这个租户下被停用，等同不属于。
 */
@Entity('sys_user_tenant')
@Index('uniq_sys_user_tenant', ['userId', 'tenantId'], { unique: true })
export class UserTenantEntity {
  @ApiProperty({ description: '主键' })
  @PrimaryGeneratedColumn({ comment: '主键' })
  id: number

  @ApiProperty({ description: '用户 ID' })
  @Column({ type: 'varchar', length: 32, comment: '用户ID' })
  userId: string

  @ApiProperty({ description: '租户 ID' })
  @Column({ type: 'int', comment: '租户ID' })
  tenantId: number

  @ApiPropertyOptional({ description: '状态：0 正常 / 1 停用', nullable: true })
  @Column({ type: 'tinyint', default: 0, comment: '状态:0正常 1停用' })
  status?: number

  @ApiPropertyOptional({ description: '加入时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '创建时间' })
  createTime?: Date | null
}
