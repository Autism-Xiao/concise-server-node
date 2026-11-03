import { PartialType } from '@nestjs/mapped-types'
import { CreateRoleDto } from './create-role.dto'

/** 更新时所有字段均可选 */
export class UpdateRoleDto extends PartialType(CreateRoleDto) {}
