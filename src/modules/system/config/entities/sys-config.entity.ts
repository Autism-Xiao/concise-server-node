import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

/**
 * 系统参数配置
 *
 * 与字典的区别：字典是「枚举值集合」（给下拉框用），参数是「运行时可调的标量/开关」。
 * 这里的值会被代码实时读取（密码策略、上传上限等），改完立即生效，不需要重启。
 *
 * 注意：不含 tenant_id —— 参数是平台级全局配置。若将来要支持租户差异化，
 * 加 tenant_id 并在 get() 里做「精确租户 → 回落 0（平台默认）」两级查找。
 */
@Entity('sys_config')
export class SysConfigEntity {
  @ApiProperty({ description: '主键' })
  @PrimaryGeneratedColumn()
  id: number

  @ApiProperty({ description: '参数键（唯一，点号分组，如 security.password.minLength）', example: 'security.password.minLength' })
  @Column({ name: 'config_key', type: 'varchar', length: 128, unique: true })
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
