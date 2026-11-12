import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, ManyToMany, PrimaryColumn } from 'typeorm'
import { UserEntity } from '../../../user/entities/user.entity'

/**
 * 组织机构表
 * - 主键 32 位字符串；parent_id 为 null/'' 视为顶级
 * - org_code 唯一且必填（既有的机构编码字段，也用于用户 sys_user.org_code）
 * - status / del_flag 为 varchar：'1'/'0'（沿用原样）
 * - 部门↔用户走 sys_user_depart（dep_id + user_id），一个部门可挂多个用户
 */
@Entity('sys_depart')
export class DeptEntity {
  @ApiProperty({ description: '主键 ID（32 位字符串）', example: 'dept_1' })
  @PrimaryColumn({ type: 'varchar', length: 32, comment: 'ID' })
  id: string

  @ApiPropertyOptional({ description: '父机构 ID，null 为顶级', example: 'dept_1', nullable: true })
  @Column({ type: 'varchar', length: 32, nullable: true, comment: '父机构ID' })
  parentId?: string | null

  @ApiProperty({ description: '机构/部门名称', example: '研发部' })
  @Column({ length: 100, comment: '机构/部门名称' })
  departName: string

  @ApiPropertyOptional({ description: '英文名', nullable: true })
  @Column({ length: 500, nullable: true, comment: '英文名' })
  departNameEn?: string

  @ApiPropertyOptional({ description: '缩写', nullable: true })
  @Column({ length: 500, nullable: true, comment: '缩写' })
  departNameAbbr?: string

  @ApiPropertyOptional({ description: '排序', example: 0 })
  @Column({ type: 'int', default: 0, comment: '排序' })
  departOrder?: number

  @ApiPropertyOptional({ description: '描述 / 负责人', example: '负责人：李工', nullable: true })
  @Column({ length: 500, nullable: true, comment: '描述' })
  description?: string

  @ApiPropertyOptional({ description: '机构类别：1 公司 / 2 部门 / 3 岗位 / 4 子公司', example: '2', nullable: true })
  @Column({ length: 10, default: '1', comment: '机构类别 1公司，2部门，3岗位，4子公司' })
  orgCategory?: string

  @ApiPropertyOptional({ description: '树深度层级', example: '1', nullable: true })
  @Column({ length: 10, nullable: true, comment: '树深度层级level' })
  orgType?: string

  @ApiProperty({ description: '机构编码（唯一，空则自动生成，如 A01 / A01A01）', example: 'A01' })
  @Column({ length: 64, unique: true, comment: '机构编码' })
  orgCode: string

  @ApiPropertyOptional({ description: '手机号', example: '13800138000', nullable: true })
  @Column({ length: 32, nullable: true, comment: '手机号' })
  mobile?: string

  @ApiPropertyOptional({ description: '传真', nullable: true })
  @Column({ length: 32, nullable: true, comment: '传真' })
  fax?: string

  @ApiPropertyOptional({ description: '地址', nullable: true })
  @Column({ length: 100, nullable: true, comment: '地址' })
  address?: string

  @ApiPropertyOptional({ description: '备注', nullable: true })
  @Column({ length: 500, nullable: true, comment: '备注' })
  memo?: string

  @ApiPropertyOptional({ description: '状态：1 启用 / 0 不启用', example: '1', nullable: true })
  @Column({ length: 1, default: '1', comment: '状态（1启用，0不启用）' })
  status?: string

  @ApiPropertyOptional({ description: '删除状态：0 正常 / 1 已删除', example: '0', nullable: true })
  @Column({ length: 1, default: '0', comment: '删除状态（0，正常，1已删除）' })
  delFlag?: string

  @ApiPropertyOptional({ description: '创建人', nullable: true })
  @Column({ length: 32, nullable: true, comment: '创建人' })
  createBy?: string

  @ApiPropertyOptional({ description: '创建时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '创建日期' })
  createTime?: Date

  @ApiPropertyOptional({ description: '更新人', nullable: true })
  @Column({ length: 32, nullable: true, comment: '更新人' })
  updateBy?: string

  @ApiPropertyOptional({ description: '更新时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '更新日期' })
  updateTime?: Date

  @ApiPropertyOptional({ description: '租户 ID（默认 0）', example: 0, nullable: true })
  @Column({ type: 'int', default: 0, comment: '租户ID' })
  tenantId?: number

  @ApiPropertyOptional({ description: '是否有叶子节点：1 是 / 0 否', example: 0, nullable: true })
  @Column({ type: 'tinyint', default: 0, comment: '是否有叶子节点: 1是0否' })
  izLeaf?: number

  /** 反向关系：仅用于 TypeORM 关系映射，不参与 JSON 序列化场景（不加载即不出现） */
  @ManyToMany(() => UserEntity, user => user.depts)
  users?: UserEntity[]
}
