import { PartialType } from '@nestjs/mapped-types'
import { CreateLevelDto } from './create-level.dto'

/** 更新时所有字段均可选 */
export class UpdateLevelDto extends PartialType(CreateLevelDto) {}
