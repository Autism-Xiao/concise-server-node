import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

/** 套餐枚举（前端展示文案：试用版 / 标准版 / 企业版） */
export const TENANT_PLAN = {
  TRIAL: 'trial',
  STANDARD: 'standard',
  ENTERPRISE: 'enterprise'
} as const

export type TenantPlanCode = (typeof TENANT_PLAN)[keyof typeof TENANT_PLAN]

/** 租户状态：0 正常 / 1 停用 */
export const TENANT_STATUS = {
  NORMAL: 0,
  DISABLED: 1
} as const

/**
 * 租户表
 *
 * - 主键自增 int（业务表 tenant_id 是 int，保持一致）
 * - code 全局唯一，作为对外稳定标识（改名不影响数据归属）
 * - expire_at 为空表示永久有效；过期后租户内账号只能登录不能写（见 TenantService.assertUsable）
 * - del_flag 软删：删除租户不物理清数据，避免误删整租户的业务表
 */
@Entity('sys_tenant')
export class TenantEntity {
  @ApiProperty({ description: '主键', example: 1 })
  @PrimaryGeneratedColumn({ comment: '主键' })
  id: number

  @ApiProperty({ description: '租户名称', example: '某某科技有限公司' })
  @Column({ length: 100, comment: '租户名称' })
  name: string

  @ApiProperty({ description: '租户编码（唯一）', example: 'acme' })
  @Column({ length: 64, unique: true, comment: '租户编码' })
  code: string

  @ApiPropertyOptional({ description: '联系人', nullable: true })
  @Column({ length: 50, default: '', comment: '联系人' })
  contact?: string

  @ApiPropertyOptional({ description: '联系电话', nullable: true })
  @Column({ length: 30, default: '', comment: '联系电话' })
  phone?: string

  @ApiPropertyOptional({ description: '套餐：trial / standard / enterprise', example: 'standard', nullable: true })
  @Column({ length: 20, default: TENANT_PLAN.STANDARD, comment: '套餐' })
  plan?: string

  @ApiPropertyOptional({ description: '开通日期', nullable: true })
  @Column({ type: 'date', nullable: true, comment: '开通日期' })
  beginDate?: string | null

  @ApiPropertyOptional({ description: '到期日期（空=永久）', nullable: true })
  @Column({ type: 'date', nullable: true, comment: '到期日期' })
  expireAt?: string | null

  @ApiProperty({ description: '状态：0 正常 / 1 停用', example: 0 })
  @Column({ type: 'tinyint', default: TENANT_STATUS.NORMAL, comment: '状态:0正常 1停用' })
  status: number

  @ApiPropertyOptional({ description: '备注', nullable: true })
  @Column({ length: 255, default: '', comment: '备注' })
  remark?: string

  @ApiPropertyOptional({ description: '删除标记：0 正常 / 1 已删除', nullable: true })
  @Column({ type: 'tinyint', default: 0, comment: '删除标记' })
  delFlag?: number

  @ApiPropertyOptional({ description: '创建人', nullable: true })
  @Column({ type: 'varchar', length: 32, nullable: true, comment: '创建人' })
  createBy?: string | null

  @ApiPropertyOptional({ description: '创建时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '创建时间' })
  createTime?: Date | null

  @ApiPropertyOptional({ description: '更新人', nullable: true })
  @Column({ type: 'varchar', length: 32, nullable: true, comment: '更新人' })
  updateBy?: string | null

  @ApiPropertyOptional({ description: '更新时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '更新时间' })
  updateTime?: Date | null
}
