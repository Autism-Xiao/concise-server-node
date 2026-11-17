import { ApiProperty } from '@nestjs/swagger'
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator'

/** 全量重设租户套餐入参：传完整勾选 id 列表（含目录/菜单/按钮节点） */
export class SetTenantPackageDto {
  @ApiProperty({ description: '套餐菜单 id 全量列表（sys_permission.id，租户级）；空数组即清空套餐', type: [String] })
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  @MaxLength(32, { each: true, message: '菜单 ID 长度不合法' })
  menuIds!: string[]
}
