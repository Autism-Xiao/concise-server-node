import { PartialType } from '@nestjs/mapped-types'

import { CreateDictDto } from './create-dict.dto'

/** 更新字典：所有字段可选 */
export class UpdateDictDto extends PartialType(CreateDictDto) {}
