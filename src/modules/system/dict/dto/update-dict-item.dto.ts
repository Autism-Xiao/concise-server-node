import { PartialType } from '@nestjs/mapped-types'

import { CreateDictItemDto } from './create-dict-item.dto'

/** 更新字典项：所有字段可选 */
export class UpdateDictItemDto extends PartialType(CreateDictItemDto) {}
