import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, PrimaryColumn } from 'typeorm'

/** 开放平台应用档案：第三方系统拿 client_id + client_secret 换访问令牌 */
@Entity('sys_app')
export class SysAppEntity {
  @ApiProperty({ description: '主键 ID（32 位字符串）' })
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '主键id' })
  id: string

  @ApiProperty({ description: '租户 ID（0=平台级应用）' })
  @Column({ type: 'int', default: 0, name: 'tenant_id', comment: '租户ID(0=平台级)' })
  tenantId: number

  @ApiProperty({ description: '应用名称', example: '库存同步机器人' })
  @Column({ type: 'varchar', length: 64, name: 'app_name', comment: '应用名称' })
  appName: string

  @ApiProperty({ description: '客户端 ID（对第三方公开）' })
  @Column({ type: 'varchar', length: 64, name: 'client_id', comment: '客户端ID(对第三方公开)' })
  clientId: string

  @ApiProperty({ description: '状态（0 启用 / 1 停用）', example: '0' })
  @Column({ type: 'char', length: 1, default: '0', comment: '状态(0启用 1停用)' })
  status: string

  @ApiProperty({ description: '授权范围（JSON 数组字符串，如 ["user:read","file:read"]）' })
  @Column({ type: 'text', nullable: true, comment: '授权范围(JSON数组)' })
  scopes?: string | null

  @ApiPropertyOptional({ description: '备注', nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '备注' })
  remark?: string | null

  @Column({ type: 'char', length: 1, default: '0', name: 'del_flag', comment: '删除标志(0存在 1删除)' })
  delFlag: string

  @ApiPropertyOptional({ description: '创建人', nullable: true })
  @Column({ type: 'varchar', length: 32, name: 'create_by', nullable: true, comment: '创建人' })
  createBy?: string | null

  @ApiProperty({ description: '创建时间' })
  @Column({ type: 'datetime', precision: 3, name: 'create_time', comment: '创建时间' })
  createTime: Date

  @ApiPropertyOptional({ description: '更新时间', nullable: true })
  @Column({ type: 'datetime', precision: 3, name: 'update_time', nullable: true, comment: '更新时间' })
  updateTime?: Date | null
}
