import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

/**
 * 系统参数配置
 *
 * 与字典的区别：字典是「枚举值集合」（给下拉框用），参数是「运行时可调的标量/开关」。
 * 这里的值会被代码实时读取（密码策略、上传上限等），改完立即生效，不需要重启。
 *
 * 租户两级查找：tenant_id = 0 是平台级参数（所有租户的默认值）；
 * 租户在 allow_tenant = 1 的参数上可以写自己的覆盖行（tenant_id = 租户 ID），
 * 读取顺序 = 精确租户行 → 平台行（tenant_id = 0）→ 代码默认值（DEFAULTS）。
 * 唯一键是 (tenant_id, config_key)：同一参数每个租户最多一行覆盖。
 */
@Entity('sys_config')
export class SysConfigEntity {
  @ApiProperty({ description: '主键' })
  @PrimaryGeneratedColumn()
  id: number

  @ApiProperty({ description: '租户 ID（0 = 平台级参数，>0 = 租户覆盖行）', example: 0 })
  @Column({ name: 'tenant_id', type: 'int', default: 0, comment: '租户ID(0=平台级)' })
  tenantId: number

  @ApiProperty({ description: '参数键（点号分组，如 security.password.minLength；同一租户内唯一）', example: 'security.password.minLength' })
  @Column({ name: 'config_key', type: 'varchar', length: 128 })
  configKey: string

  @ApiPropertyOptional({ description: '参数值（统一存字符串，按 valueType 解析）' })
  @Column({ name: 'config_value', type: 'text', nullable: true })
  configValue?: string | null

  @ApiProperty({ description: '值类型：string / number / boolean / json', example: 'number' })
  @Column({ name: 'value_type', type: 'varchar', length: 16, default: 'string' })
  valueType: string

  @ApiProperty({ description: '分组（前端按组渲染）', example: 'security' })
  @Column({ name: 'config_group', type: 'varchar', length: 64, default: 'general' })
  configGroup: string

  @ApiProperty({ description: '中文名' })
  @Column({ type: 'varchar', length: 128 })
  name: string

  @ApiPropertyOptional({ description: '说明' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  remark?: string | null

  @ApiPropertyOptional({ description: '是否内置：1 内置（不可删除，可改值）' })
  @Column({ name: 'is_builtin', type: 'tinyint', default: 0 })
  isBuiltin: number

  @ApiPropertyOptional({ description: '租户可覆盖：1 = 租户可写自己的值（0 = 仅平台可改）' })
  @Column({ name: 'allow_tenant', type: 'tinyint', default: 0, comment: '租户可覆盖(1=租户可写)' })
  allowTenant: number

  @ApiPropertyOptional({ description: '删除标记：0 正常 / 1 已删除' })
  @Column({ name: 'del_flag', type: 'tinyint', default: 0 })
  delFlag: number

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date
}
