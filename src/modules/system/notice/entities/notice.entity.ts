import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

@Entity('notice')
export class NoticeEntity {
  @ApiProperty({ description: '公告 ID', example: 1 })
  @PrimaryGeneratedColumn()
  id: number

  @ApiProperty({ description: '公告标题', example: '系统上线通知' })
  @Column({ length: 64, comment: '公告标题' })
  title: string

  @ApiProperty({ description: '类型：1 通知 / 2 公告', example: 1, enum: [1, 2] })
  @Column({ type: 'tinyint', default: 1, comment: '类型：1通知 2公告' })
  type: number

  @ApiPropertyOptional({ description: '公告内容（富文本）', nullable: true })
  @Column({ type: 'text', nullable: true, comment: '公告内容' })
  content?: string

  @ApiProperty({ description: '状态：0 草稿 / 1 已发布', example: 0, enum: [0, 1] })
  @Column({ type: 'tinyint', default: 0, comment: '状态：0草稿 1已发布' })
  status: number

  @ApiPropertyOptional({ description: '发布时间（发布时自动写入）', nullable: true })
  @Column({ name: 'published_at', type: 'datetime', nullable: true, comment: '发布时间' })
  publishedAt?: Date | null

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
  createdAt: Date

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at', comment: '更新时间' })
  updatedAt: Date
}
