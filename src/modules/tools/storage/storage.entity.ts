import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

/** 文件存储记录实体（对应 nest-admin 的 tool_storage 表，列名显式声明避免命名策略差异） */
@Entity('tool_storage')
export class StorageEntity {
  @ApiProperty({ description: '记录 ID', example: 1 })
  @PrimaryGeneratedColumn()
  id: number

  @ApiProperty({ description: '重命名后的文件名', example: 'logo-20261104103000123.png' })
  @Column({ length: 200, comment: '文件名' })
  name: string

  @ApiPropertyOptional({ description: '原始文件名', example: 'logo.png', nullable: true })
  @Column({ name: 'file_name', length: 200, nullable: true, comment: '真实文件名' })
  fileName?: string

  @ApiPropertyOptional({ description: '扩展名', example: 'png', nullable: true })
  @Column({ name: 'ext_name', length: 32, nullable: true, comment: '扩展名' })
  extName?: string

  @ApiProperty({ description: '相对访问路径', example: '/upload/2026-11-04/图片/logo-xxx.png' })
  @Column({ length: 255, comment: '访问路径' })
  path: string

  @ApiProperty({ description: '文件类型', example: '图片' })
  @Column({ length: 16, nullable: true, comment: '文件类型' })
  type: string

  @ApiPropertyOptional({ description: '文件大小（可读格式）', example: '23.4 KB', nullable: true })
  @Column({ length: 32, nullable: true, comment: '文件大小' })
  size?: string

  @ApiPropertyOptional({ description: '上传用户 ID', example: 1, nullable: true })
  @Column({ name: 'user_id', type: 'varchar', length: 32, nullable: true, comment: '上传用户ID' })
  userId?: string

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
  createdAt: Date

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at', comment: '更新时间' })
  updatedAt: Date
}
