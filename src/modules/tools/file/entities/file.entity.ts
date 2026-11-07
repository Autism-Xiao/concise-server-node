import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * 文件管理实体 sys_file（文件夹与文件同表，靠 isFolder 区分）
 *
 * 为什么另起一张表而不是复用 tool_storage：
 *  - tool_storage 只记「上传了哪些图片」，没有 parent_id / is_folder / 软删，撑不起目录树；
 *  - 它的 size 存的是 "23.4 KB" 这种可读字符串，没法做配额统计和按大小排序。
 *
 * 物理文件不按目录存放：storage_key 用 sha256 内容寻址（storage/files/yyyy/MM/{hash}.{ext}），
 * 改名/移动只改这张表的 name / parent_id，磁盘上什么都不用动。
 */
@Entity('sys_file')
@Index('idx_sys_file_owner_parent', ['ownerId', 'parentId', 'isDeleted'])
@Index('idx_sys_file_owner_deleted_update', ['ownerId', 'isDeleted', 'updateTime'])
export class FileEntity {
  @ApiProperty({ description: '主键 ID', example: 1 })
  @PrimaryGeneratedColumn({ comment: '主键' })
  id: number

  @ApiProperty({ description: '父目录 ID，0 表示根目录', example: 0 })
  @Column({ type: 'int', default: 0, comment: '父目录ID(0=根目录)' })
  parentId: number

  @ApiProperty({ description: '显示名称（含扩展名）', example: '年度报告.xlsx' })
  @Column({ type: 'varchar', length: 255, comment: '显示名称' })
  name: string

  @ApiProperty({ description: '是否文件夹：1 是 / 0 否', example: 0 })
  @Column({ type: 'tinyint', default: 0, comment: '是否文件夹' })
  isFolder: number

  @ApiPropertyOptional({ description: '扩展名（小写、不含点）', example: 'xlsx' })
  @Column({ type: 'varchar', length: 32, default: '', comment: '扩展名' })
  ext: string

  @ApiPropertyOptional({ description: 'MIME 类型', example: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  @Column({ type: 'varchar', length: 120, default: '', comment: 'MIME 类型' })
  mime: string

  @ApiProperty({ description: '字节数（文件夹为 0）', example: 20480 })
  @Column({
    type: 'bigint',
    default: 0,
    // MySQL 的 BIGINT 经 mysql2 回来是字符串，这里统一转 number，避免前端拿到 "20480" 参与运算出错
    transformer: { to: (value: number) => value, from: (value: string | number | null) => Number(value ?? 0) },
    comment: '字节数'
  })
  size: number

  @ApiPropertyOptional({ description: '物理相对路径（服务端生成，前端不传）', example: '2026/11/ab12...ef.xlsx' })
  @Column({ type: 'varchar', length: 255, default: '', comment: '物理相对路径' })
  storageKey: string

  @ApiPropertyOptional({ description: 'sha256（去重与秒传用）', example: 'a1b2...' })
  @Column({ type: 'char', length: 64, default: '', comment: 'sha256' })
  hash: string

  @ApiProperty({ description: '所有者用户 ID', example: '1' })
  @Column({ type: 'varchar', length: 32, default: '', comment: '所有者用户ID' })
  ownerId: string

  @ApiPropertyOptional({ description: '所属部门 ID', example: 0 })
  @Column({ type: 'int', default: 0, comment: '所属部门ID' })
  deptId: number

  @ApiProperty({ description: '是否星标', example: 0 })
  @Column({ type: 'tinyint', default: 0, comment: '是否星标' })
  isStarred: number

  @ApiProperty({ description: '是否已删除（回收站）', example: 0 })
  @Column({ type: 'tinyint', default: 0, comment: '是否已删除' })
  isDeleted: number

  @ApiPropertyOptional({ description: '删除时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '删除时间' })
  deletedAt?: Date | null

  @ApiProperty({ description: '排序值（小的在前）', example: 0 })
  @Column({ type: 'int', default: 0, comment: '排序' })
  sortOrder: number

  @ApiPropertyOptional({ description: '备注', example: '' })
  @Column({ type: 'varchar', length: 255, default: '', comment: '备注' })
  remark: string

  @ApiPropertyOptional({ description: '创建时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '创建时间' })
  createTime?: Date

  @ApiPropertyOptional({ description: '更新时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '更新时间' })
  updateTime?: Date
}
