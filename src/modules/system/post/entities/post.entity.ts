import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, ManyToOne, PrimaryColumn, JoinColumn } from 'typeorm'
import { DeptEntity } from '../../dept/entities/dept.entity'

/**
 * 岗位表（对齐 JeecgBoot sys_position）
 * - 主键 32 位字符串；post_code 唯一
 * - 补充 dept_id（所属部门，JeecgBoot 新版走职位↔部门关联，这里简化为直挂一列）与 status
 */
@Entity('sys_position')
export class PostEntity {
  @ApiProperty({ description: '主键 ID（32 位字符串）' })
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '主键id' })
  id: string

  @ApiProperty({ description: '岗位编码（唯一）', example: 'dev_engineer' })
  @Column({ length: 100, unique: true, comment: '岗位编码' })
  postCode: string

  @ApiProperty({ description: '岗位名称', example: '研发工程师' })
  @Column({ length: 100, comment: '岗位名称' })
  postName: string

  @ApiPropertyOptional({ description: '排序', example: 1, nullable: true })
  @Column({ type: 'int', default: 0, comment: '排序' })
  postSort?: number

  @ApiPropertyOptional({ description: '所属部门 ID（sys_depart.id）', example: 'dept_1', nullable: true })
  @Column({ type: 'varchar', length: 32, nullable: true, comment: '所属部门ID' })
  deptId?: string | null

  @ApiPropertyOptional({ description: '状态：1 正常 / 0 停用', example: '1', nullable: true })
  @Column({ length: 1, default: '1', comment: '状态（1正常，0停用）' })
  status?: string

  @ApiPropertyOptional({ description: '描述', nullable: true })
  @Column({ length: 500, nullable: true, comment: '描述' })
  description?: string

  @ApiPropertyOptional({ description: '创建人', nullable: true })
  @Column({ length: 32, nullable: true, comment: '创建人' })
  createBy?: string

  @ApiPropertyOptional({ description: '创建时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '创建时间' })
  createTime?: Date

  @ApiPropertyOptional({ description: '更新人', nullable: true })
  @Column({ length: 32, nullable: true, comment: '更新人' })
  updateBy?: string

  @ApiPropertyOptional({ description: '更新时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '更新时间' })
  updateTime?: Date

  @ApiPropertyOptional({ description: '租户 ID（对齐 JeecgBoot，默认 0）', example: 0, nullable: true })
  @Column({ type: 'int', default: 0, comment: '租户ID' })
  tenantId?: number

  @ApiPropertyOptional({ description: '所属部门（查询时带出）', type: DeptEntity, nullable: true })
  @ManyToOne(() => DeptEntity, { nullable: true, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'dept_id' })
  dept?: DeptEntity | null
}
