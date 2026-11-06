import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

import { BATCH_DELETE_MAX } from '../../../helper/crud/batch-delete'

/** 批量启用/停用：与单条 setStatus 同规则（冻结踢会话、内置 admin 保护） */
export class BatchUserStatusDto {
  @ApiProperty({ description: `目标用户 ID 列表，单次最多 ${BATCH_DELETE_MAX} 条`, type: [String], example: ['e9ca23d68d884d4ebb19d07889727dae'] })
  @IsArray({ message: 'ids 必须是数组' })
  @ArrayNotEmpty({ message: '请选择要操作的用户' })
  @ArrayMaxSize(BATCH_DELETE_MAX, { message: `单次最多操作 ${BATCH_DELETE_MAX} 条` })
  @IsString({ each: true, message: '每个 id 必须是字符串' })
  ids!: string[]

  @ApiProperty({ description: '目标状态：1 正常 / 2 冻结', enum: [1, 2], example: 2 })
  @IsIn([1, 2], { message: '状态只允许 1（正常）或 2（冻结）' })
  status!: number

  @ApiPropertyOptional({ description: '变更原因（进操作日志参数，便于审计追溯）', example: '长期未登录' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string
}

/** 批量分配角色：对列表内每个用户全量覆盖绑定同一组角色 */
export class BatchAssignRolesDto {
  @ApiProperty({ description: `目标用户 ID 列表，单次最多 ${BATCH_DELETE_MAX} 条`, type: [String], example: ['e9ca23d68d884d4ebb19d07889727dae'] })
  @IsArray({ message: 'ids 必须是数组' })
  @ArrayNotEmpty({ message: '请选择要操作的用户' })
  @ArrayMaxSize(BATCH_DELETE_MAX, { message: `单次最多操作 ${BATCH_DELETE_MAX} 条` })
  @IsString({ each: true, message: '每个 id 必须是字符串' })
  ids!: string[]

  @ApiProperty({ description: '要绑定的角色 ID 列表（全量覆盖语义，与单个用户绑定角色一致）', type: [String], example: ['f6817f48af4fb3af11b9e8bf182f618b'] })
  @IsArray({ message: 'roleIds 必须是数组' })
  @ArrayMaxSize(50, { message: '单次最多绑定 50 个角色' })
  @IsString({ each: true, message: '每个角色 id 必须是字符串' })
  roleIds!: string[]
}

/** 设置头像：path 来自 POST /v1/upload 返回的相对路径；空串/null 表示清除 */
export class UpdateAvatarDto {
  @ApiPropertyOptional({ description: '头像相对路径（来自上传接口）；不传或空串表示清除头像', example: '/upload/2026-11-07/image/xxx.png' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  avatar?: string | null
}
