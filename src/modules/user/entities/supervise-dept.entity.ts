import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm'

/** 用户管辖部门关系（ReBAC 轻量版）：dept_id 存的是已展开的有效部门，查询期直接 IN */
@Entity('sys_user_supervise_dept')
export class SuperviseDeptEntity {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id!: string

  @Column({ name: 'user_id', type: 'varchar', length: 32, comment: '被授权用户ID' })
  userId!: string

  @Column({ name: 'dept_id', type: 'varchar', length: 32, comment: '管辖部门ID（含展开的子孙部门）' })
  deptId!: string

  @Column({ name: 'tenant_id', type: 'int', default: 0, comment: '租户ID(0=平台级)' })
  tenantId!: number

  @CreateDateColumn({ name: 'create_time', type: 'datetime', precision: 3, comment: '创建时间' })
  createTime!: Date
}
