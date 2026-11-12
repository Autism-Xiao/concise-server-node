import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * 通知公告表
 *
 * 与原表的差异说明：
 * - 标题列名在原始建表时就是拼错的 `titile`，这里保留库列名不改，实体属性用 title 方便业务代码
 * - send_status / del_flag 在原始设计里是 varchar，沿用字符串语义（'0'/'1'/'2'）
 * - 主键 varchar(32)，由 BaseService 自动生成 32 位随机串
 */
@Entity('sys_announcement')
export class SysAnnouncementEntity {
  @ApiProperty({ description: '主键 ID（32 位字符串）' })
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '主键id' })
  id: string

  @ApiPropertyOptional({ description: '租户 ID（0=平台共享，所有租户可见）', example: 1 })
  @Column({ type: 'int', default: 1, comment: '租户ID(0=平台共享)' })
  tenantId?: number

  /** 列名是历史遗留的拼写错误 titile，不要"修正"，否则与库不一致 */
  @ApiProperty({ description: '标题', example: '系统 V1.0 上线' })
  @Column({ name: 'titile', length: 100, comment: '标题' })
  title: string

  @ApiPropertyOptional({ description: '内容（富文本或纯文本）' })
  @Column({ name: 'msg_content', type: 'text', nullable: true, comment: '内容' })
  msgContent?: string

  @ApiProperty({ description: '消息类型：1 通知公告 / 2 系统消息', example: '1', enum: ['1', '2'] })
  @Column({ name: 'msg_category', length: 10, default: '1', comment: '消息类型（1通知公告 2系统消息）' })
  msgCategory: string

  @ApiPropertyOptional({ description: '通告对象类型：ALL 全体用户 / USER 指定用户', example: 'ALL', enum: ['ALL', 'USER'] })
  @Column({ name: 'msg_type', length: 10, nullable: true, comment: '通告对象类型（USER指定用户 ALL全体用户）' })
  msgType?: string

  @ApiPropertyOptional({ description: '优先级：L 低 / M 中 / H 高', example: 'M', enum: ['L', 'M', 'H'] })
  @Column({ length: 255, nullable: true, comment: '优先级（L低 M中 H高）' })
  priority?: string

  @ApiProperty({ description: '发布状态：0 未发布 / 1 已发布 / 2 已撤销', example: '0', enum: ['0', '1', '2'] })
  @Column({ name: 'send_status', length: 10, default: '0', comment: '发布状态（0未发布 1已发布 2已撤销）' })
  sendStatus: string

  @ApiPropertyOptional({ description: '发布人', example: 'admin' })
  @Column({ length: 100, nullable: true, comment: '发布人' })
  sender?: string

  @ApiPropertyOptional({ description: '发布时间（发布时自动写入）' })
  @Column({ name: 'send_time', type: 'datetime', nullable: true, comment: '发布时间' })
  sendTime?: Date

  @ApiPropertyOptional({ description: '撤销时间（撤销时自动写入）' })
  @Column({ name: 'cancel_time', type: 'datetime', nullable: true, comment: '撤销时间' })
  cancelTime?: Date

  @ApiPropertyOptional({ description: '生效开始时间' })
  @Column({ name: 'start_time', type: 'datetime', nullable: true, comment: '开始时间' })
  startTime?: Date

  @ApiPropertyOptional({ description: '生效结束时间' })
  @Column({ name: 'end_time', type: 'datetime', nullable: true, comment: '结束时间' })
  endTime?: Date

  @ApiPropertyOptional({ description: '指定接收用户 ID（逗号分隔，msgType=USER 时生效）' })
  @Column({ name: 'user_ids', type: 'text', nullable: true, comment: '指定用户' })
  userIds?: string

  @ApiProperty({ description: '删除标志：0 正常 / 1 已删除', example: '0' })
  @Column({ name: 'del_flag', length: 1, default: '0', comment: '删除状态（0正常 1已删除）' })
  delFlag: string

  @ApiPropertyOptional({ description: '创建人' })
  @Column({ name: 'create_by', length: 32, nullable: true, comment: '创建人' })
  createBy?: string

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'create_time', type: 'datetime', comment: '创建时间' })
  createTime: Date

  @ApiPropertyOptional({ description: '更新人' })
  @Column({ name: 'update_by', length: 32, nullable: true, comment: '更新人' })
  updateBy?: string

  @ApiPropertyOptional({ description: '更新时间' })
  @UpdateDateColumn({ name: 'update_time', type: 'datetime', comment: '更新时间' })
  updateTime: Date
}
