import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

/**
 * 行政区划表 sys_region
 * - 关联关系用 area_code / parent_code（区划代码），不依赖自增 id
 * - level：0 省份 / 1 城市 / 2 区县 / 3 街道（预留）
 * - lng/lat 存 varchar：源数据（民政部/第三方区划库）即字符串，避免精度转换问题
 */
@Entity('sys_region')
export class RegionEntity {
  @ApiProperty({ description: '主键 ID', example: 1 })
  @PrimaryGeneratedColumn({ type: 'bigint', comment: '主键' })
  id: number

  @ApiProperty({ description: '区划代码（全局唯一）', example: '440000000000' })
  @Column({ type: 'varchar', length: 20, unique: true, comment: '区划代码(唯一)' })
  areaCode: string

  @ApiPropertyOptional({ description: '城市代码（电话区号，如 00852）', example: '', nullable: true })
  @Column({ type: 'varchar', length: 10, default: '', comment: '城市代码(电话区号)' })
  cityCode: string

  @ApiProperty({ description: '上级区划代码，顶级为 "0"', example: '0' })
  @Column({ type: 'varchar', length: 20, default: '0', comment: '上级区划代码(顶级为0)' })
  parentCode: string

  @ApiPropertyOptional({ description: '邮政编码', example: '518000', nullable: true })
  @Column({ type: 'varchar', length: 10, default: '', comment: '邮政编码' })
  zipCode: string

  @ApiProperty({ description: '层级：0 省份 / 1 城市 / 2 区县 / 3 街道', example: 0 })
  @Column({ type: 'tinyint', default: 0, comment: '层级(0省份 1城市 2区县 3街道)' })
  level: number

  @ApiPropertyOptional({ description: '层级文本（省份/城市/区县/街道）', example: '省份', nullable: true })
  @Column({ type: 'varchar', length: 10, default: '', comment: '层级文本' })
  levelText: string

  @ApiPropertyOptional({ description: '父级 ID（冗余字段，顶级为 0）', example: 0, nullable: true })
  @Column({ type: 'bigint', default: 0, comment: '父级ID(冗余,顶级为0)' })
  pid: number

  @ApiProperty({ description: '名称', example: '广东省' })
  @Column({ type: 'varchar', length: 100, comment: '名称' })
  name: string

  @ApiPropertyOptional({ description: '简称', example: '广东', nullable: true })
  @Column({ type: 'varchar', length: 50, default: '', comment: '简称' })
  shortName: string

  @ApiPropertyOptional({ description: '全称', example: '广东', nullable: true })
  @Column({ type: 'varchar', length: 100, default: '', comment: '全称' })
  fullName: string

  @ApiPropertyOptional({ description: '拼音', example: 'GuangDong', nullable: true })
  @Column({ type: 'varchar', length: 100, default: '', comment: '拼音' })
  pinyin: string

  @ApiPropertyOptional({ description: '经度', example: '113.266530', nullable: true })
  @Column({ type: 'varchar', length: 20, default: '', comment: '经度' })
  lng: string

  @ApiPropertyOptional({ description: '纬度', example: '23.132191', nullable: true })
  @Column({ type: 'varchar', length: 20, default: '', comment: '纬度' })
  lat: string

  @ApiPropertyOptional({ description: '创建时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '创建时间' })
  createTime?: Date

  @ApiPropertyOptional({ description: '更新时间', nullable: true })
  @Column({ type: 'datetime', nullable: true, comment: '更新时间' })
  updateTime?: Date
}
