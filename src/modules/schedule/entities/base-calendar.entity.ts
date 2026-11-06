import { ApiProperty } from '@nestjs/swagger'
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

/** 日历分类表 base_calendar */
@Entity('base_calendar')
export class BaseCalendarEntity {
  @ApiProperty({ description: '主键 ID', example: 1 })
  @PrimaryGeneratedColumn({ type: 'bigint', comment: '主键' })
  id: number

  @ApiProperty({ description: '日历名称', example: '我的日程' })
  @Column({ type: 'varchar', length: 50, comment: '日历名称' })
  name: string

  @ApiProperty({ description: '颜色标识', example: '#1890ff', default: '#1890ff' })
  @Column({ type: 'varchar', length: 20, default: '#1890ff', comment: '颜色标识' })
  color: string

  @ApiProperty({ description: '属主用户 ID' })
  @Column({ type: 'varchar', length: 32, comment: '属主用户ID' })
  ownerId: string

  @ApiProperty({ description: '是否公开（公开日历的事件全员可见）', default: false })
  @Column({ type: 'tinyint', default: 0, comment: '是否公开' })
  isPublic: boolean

  @ApiProperty({ description: '创建时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '创建时间' })
  createTime: Date

  @ApiProperty({ description: '更新时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '更新时间' })
  updateTime: Date
}
