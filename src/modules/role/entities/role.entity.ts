import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Column, Entity, ManyToMany, PrimaryGeneratedColumn } from 'typeorm'
import { MenuEntity } from '../../menu/entities/menu.entity'
import { UserEntity } from '../../user/entities/user.entity'

@Entity('role')
export class RoleEntity {
  @ApiProperty({ description: '角色 ID', example: 1 })
  @PrimaryGeneratedColumn()
  id: number

  @ApiProperty({ description: '角色标识（英文，用于 @Roles() 匹配）', example: 'admin' })
  @Column({ length: 32, unique: true, comment: '角色标识' })
  name: string

  @ApiProperty({ description: '角色名称（中文展示）', example: '管理员' })
  @Column({ length: 32, comment: '角色名称' })
  label: string

  @ApiProperty({ description: '状态：0 禁用 / 1 启用', example: 1, enum: [0, 1] })
  @Column({ type: 'tinyint', default: 1, comment: '状态：0禁用 1启用' })
  status: number

  @ApiPropertyOptional({ description: '备注', nullable: true })
  @Column({ length: 255, nullable: true, comment: '备注' })
  remark?: string

  @ManyToMany(() => MenuEntity, menu => menu.roles)
  menus: MenuEntity[]

  @ManyToMany(() => UserEntity, user => user.roles)
  users: UserEntity[]
}
