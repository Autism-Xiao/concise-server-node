import { ApiProperty } from '@nestjs/swagger'
import { Column, Entity, PrimaryColumn } from 'typeorm'

/**
 * 租户功能套餐（sys_tenant_menu）：租户 → 已开通的租户级菜单
 *
 * 这是「租户管理员能给自己角色授哪些菜单」的**上限**：
 * - RoleService.assignMenus 校验 menuIds ⊆ 本表
 * - 登录菜单树/权限码汇总与本表取交集
 * - 套餐本身只增不减（provision 只 INSERT IGNORE；平台管理员可用 PUT /v1/tenants/:id/menus 全量重设）
 * - 0/NULL 不参与：本表按 tenant_id > 0 记录，平台共享（0）无套餐概念
 */
@Entity('sys_tenant_menu')
export class TenantMenuEntity {
  @ApiProperty({ description: '主键 ID（32 位字符串）' })
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '主键id' })
  id: string

  @ApiProperty({ description: '租户 ID', example: 1 })
  @Column({ type: 'int', name: 'tenant_id', comment: '租户ID' })
  tenantId: number

  @ApiProperty({ description: '菜单 ID（sys_permission.id）' })
  @Column({ type: 'varchar', length: 32, name: 'permission_id', comment: '菜单ID(sys_permission.id)' })
  permissionId: string

  @ApiProperty({ description: '创建时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, name: 'create_time', comment: '创建时间' })
  createTime?: Date | null
}
