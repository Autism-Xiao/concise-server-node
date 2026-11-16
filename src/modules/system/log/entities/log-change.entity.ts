import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, PrimaryColumn } from 'typeorm'

/**
 * 字段级变更审计（谁在什么时候把哪个字段从 A 改成 B）
 *
 * 与 sys_log 的分工：sys_log 记"谁调了哪个接口"，这张表记"数据本身变了什么"。
 * 排查"这人的部门怎么被改了""谁把金额改成 0"这类问题时，只看操作日志是查不出来的
 * —— 日志里只有请求体和 URL，没有改前值。
 *
 * 设计取舍：
 * - **一行一个字段**，方便按字段过滤（`field='deptId'`），代价是更新 5 个字段就 5 行
 * - 敏感字段（密码/盐/密钥/令牌）在采集端就被丢掉，这里**不存**
 * - 值是字符串快照，最长 500 字（超长截断加省略号），不做类型还原
 */
@Entity('sys_log_change')
export class SysLogChangeEntity {
  @ApiProperty({ description: '主键 ID（32 位字符串）' })
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '主键id' })
  id: string

  @ApiProperty({ description: '租户 ID（与 sys_log 一致：0 表示平台级操作）', example: 1 })
  @Column({ type: 'int', default: 0, name: 'tenant_id', comment: '租户ID(0=平台级操作)' })
  tenantId: number

  @ApiProperty({ description: '物理表名', example: 'sys_user' })
  @Column({ type: 'varchar', length: 64, name: 'table_name', comment: '表名' })
  tableName: string

  @ApiProperty({ description: '被改记录的 ID', example: 'e9ca23d68d884d4ebb19d07889727dae' })
  @Column({ type: 'varchar', length: 64, name: 'record_id', comment: '记录id' })
  recordId: string

  @ApiProperty({ description: '字段属性名', example: 'realname' })
  @Column({ type: 'varchar', length: 64, name: 'field', comment: '字段名' })
  field: string

  @ApiPropertyOptional({ description: '字段中文名（取自实体列注释）', example: '真实姓名', nullable: true })
  @Column({ type: 'varchar', length: 64, name: 'field_label', nullable: true, comment: '字段中文名' })
  fieldLabel?: string | null

  @ApiPropertyOptional({ description: '改前值（字符串快照，超长截断）', nullable: true })
  @Column({ type: 'text', name: 'old_value', nullable: true, comment: '改前值' })
  oldValue?: string | null

  @ApiPropertyOptional({ description: '改后值（字符串快照，超长截断）', nullable: true })
  @Column({ type: 'text', name: 'new_value', nullable: true, comment: '改后值' })
  newValue?: string | null

  @ApiPropertyOptional({ description: '操作人用户 ID', nullable: true })
  @Column({ type: 'varchar', length: 32, name: 'operate_user_id', nullable: true, comment: '操作人id' })
  operateUserId?: string | null

  @ApiProperty({ description: '变更时间' })
  @Index('idx_change_time')
  @Column({ type: 'datetime', precision: 3, name: 'create_time', comment: '变更时间' })
  createTime: Date
}
